// Every place that spells out a Solana program id must agree with the program's
// own declare_id!. A regenerated keypair that misses one file ships a client that
// talks to the wrong address, so this fails the build instead.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const declared = (dir) => /declare_id!\(\s*"([^"]+)"\s*\)/.exec(read(`contracts/${dir}/src/lib.rs`))[1];

const PROGRAMS = [
	{
		dir: 'skill-license',
		name: 'skill_license',
		refs: [
			['api/_lib/skill-license-onchain.js', /\|\|\s*'([1-9A-HJ-NP-Za-km-z]{32,44})'/],
			['packages/skill-license/src/index.js', /PROGRAM_ID = '([^']+)'/],
			['contracts/idl/skill_license.json', /"address":\s*"([^"]+)"/],
			['contracts/program-tests/src/lib.rs', /SKILL_LICENSE_ID: &str = "([^"]+)"/],
		],
	},
	{
		dir: 'agent-invocation',
		name: 'agent_invocation',
		refs: [
			['api/_lib/agent-invocation-onchain.js', /\|\|\s*'([1-9A-HJ-NP-Za-km-z]{32,44})'/],
			['agent-protocol-sdk/src/idl.ts', /AGENT_INVOCATION_PROGRAM_ID = '([^']+)'/],
			['contracts/idl/agent_invocation.json', /"address":\s*"([^"]+)"/],
			['contracts/program-tests/src/lib.rs', /AGENT_INVOCATION_ID: &str = "([^"]+)"/],
		],
	},
	{
		dir: 'knock-escrow',
		name: 'knock_escrow',
		refs: [
			['api/_lib/knock/escrow.js', /KNOCK_ESCROW_PROGRAM_ID = '([^']+)'/],
			['src/knock/escrow-program.js', /KNOCK_ESCROW_PROGRAM_ID = '([^']+)'/],
			['contracts/program-tests/tests/knock_escrow.rs', /KNOCK_ESCROW_ID: &str = "([^"]+)"/],
			['contracts/program-tests/tests/knock_escrow_pda.rs', /PROGRAM: &str = "([^"]+)"/],
		],
	},
	{ dir: 'event-markets-stake', name: 'event_markets_stake', refs: [] },
];

describe('Solana program ids', () => {
	const ids = PROGRAMS.map((p) => declared(p.dir));
	it('are four distinct, well-formed addresses', () => {
		expect(new Set(ids).size).toBe(4);
		for (const id of ids) expect(id).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
	});

	for (const p of PROGRAMS) {
		it(`${p.name}: code, IDL and constants match declare_id!`, () => {
			const id = declared(p.dir);
			for (const [file, re] of p.refs) {
				const m = re.exec(read(file));
				expect(m, `${file} has no program id`).toBeTruthy();
				expect(m[1], file).toBe(id);
			}
		});
	}

	for (const dir of ['skill-license', 'agent-invocation']) {
		it(`${dir}: Anchor.toml lists the declared id for every cluster`, () => {
			const id = declared(dir);
			const ids = [...read(`contracts/${dir}/Anchor.toml`).matchAll(/^\w+ = "([1-9A-HJ-NP-Za-km-z]{32,44})"/gm)].map((m) => m[1]);
			expect(ids.length).toBeGreaterThanOrEqual(3);
			for (const x of ids) expect(x).toBe(id);
		});
	}

	it('docs that print a program id print the declared one', () => {
		const docs = {
			'contracts/skill-license/README.md': declared('skill-license'),
			'contracts/agent-invocation/README.md': declared('agent-invocation'),
			'contracts/knock-escrow/README.md': declared('knock-escrow'),
			'agent-protocol-sdk/README.md': declared('agent-invocation'),
		};
		for (const [file, id] of Object.entries(docs)) expect(read(file), file).toContain(id);
	});
});
