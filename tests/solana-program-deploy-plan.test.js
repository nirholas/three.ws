import { describe, expect, it } from 'vitest';
import {
	PROGRAMS,
	buildPlan,
	deployCostLamports,
	gate,
	parseArgs,
	parseDeclaredId,
	renderTable,
} from '../scripts/lib/solana-program-deploy-plan.mjs';

const ID = (n) => `${String(n).repeat(32)}`;
const read = (over = {}) => ({
	declaredId: (dir) => ID(PROGRAMS.findIndex((p) => p.dir === dir) + 1),
	keypairPubkey: (dir) => ID(PROGRAMS.findIndex((p) => p.dir === dir) + 1),
	soSize: () => 200_000,
	...over,
});

describe('deploy plan', () => {
	it('parses declare_id from Rust source', () => {
		expect(parseDeclaredId('declare_id!("9rPHPFHmdek5WMH92HHtMuXsbeFBbvsetfbxuVZGsWoj");')).toBe('9rPHPFHmdek5WMH92HHtMuXsbeFBbvsetfbxuVZGsWoj');
		expect(parseDeclaredId('fn main() {}')).toBeNull();
	});

	it('prices rent from the program size', () => {
		expect(deployCostLamports(400_000)).toBeGreaterThan(deployCostLamports(200_000));
		expect(deployCostLamports(200_000)).toBe((45 + 200_000 + 128) * 6960 + (36 + 128) * 6960);
	});

	it('plans all four programs on devnet by default and is a dry run without --yes', () => {
		const args = parseArgs([]);
		const plan = buildPlan(args, read());
		expect(plan.rows.map((r) => r.name)).toEqual(PROGRAMS.map((p) => p.name));
		expect(plan.mainnet).toBe(false);
		expect(gate(plan, args).run).toBe(false);
		expect(gate(plan, parseArgs(['--yes'])).run).toBe(true);
	});

	it('refuses mainnet without --confirm-mainnet and without an explicit keypair', () => {
		expect(() => buildPlan(parseArgs(['--cluster', 'mainnet-beta']), read())).toThrow(/explicit --keypair/);
		const args = parseArgs(['--cluster', 'mainnet-beta', '--keypair', 'k.json', '--yes']);
		const plan = buildPlan(args, read());
		expect(gate(plan, args)).toMatchObject({ run: false });
		expect(gate(plan, { ...args, confirmMainnet: true }).run).toBe(true);
	});

	it('rejects a keypair that does not match declare_id!', () => {
		expect(() => buildPlan(parseArgs([]), read({ keypairPubkey: () => ID(9) }))).toThrow(/does not match declare_id/);
	});

	it('rejects a missing build artifact or keypair', () => {
		expect(() => buildPlan(parseArgs([]), read({ soSize: () => null }))).toThrow(/cargo-build-sbf/);
		expect(() => buildPlan(parseArgs([]), read({ keypairPubkey: () => null }))).toThrow(/keypair missing/);
	});

	it('filters with --only and rejects unknown names, clusters and flags', () => {
		const plan = buildPlan(parseArgs(['--only', 'knock_escrow']), read());
		expect(plan.rows).toHaveLength(1);
		expect(() => buildPlan(parseArgs(['--only', 'nope']), read())).toThrow(/unknown program/);
		expect(() => buildPlan(parseArgs(['--cluster', 'testnet']), read())).toThrow(/unknown cluster/);
		expect(() => parseArgs(['--wat'])).toThrow(/unknown argument/);
	});

	it('set-upgrade-authority needs a target and does not need build artifacts', () => {
		expect(() => buildPlan(parseArgs(['set-upgrade-authority']), read())).toThrow(/--new-authority/);
		const args = parseArgs(['set-upgrade-authority', '--new-authority', ID(7)]);
		const plan = buildPlan(args, read({ soSize: () => null, keypairPubkey: () => null }));
		expect(plan.command).toBe('set-upgrade-authority');
		expect(plan.rows).toHaveLength(4);
	});

	it('renders a table naming every program id', () => {
		const t = renderTable(buildPlan(parseArgs([]), read()));
		for (const p of PROGRAMS) expect(t).toContain(p.name);
		expect(t).toContain('total rent locked');
	});
});
