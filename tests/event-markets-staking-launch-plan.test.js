import { describe, it, expect } from 'vitest';
import { evaluatePreflight, buildLaunchSteps, renderLaunchPlan, ECONOMY_WALLETS } from '../api/_lib/event-markets/staking/launch-plan.js';

const good = {
	programId: '6DsLYSQcYZSegSKgRkRMP93L7uHxvV1cQhm6YoXa9xXU', programHash: 'ab'.repeat(32), cluster: 'mainnet',
	authority: 'Auth1111111111111111111111111111111111111111', resolver: 'Resv1111111111111111111111111111111111111111',
	buybackWallet: 'Buyb1111111111111111111111111111111111111111', treasury: 'Trsy1111111111111111111111111111111111111111',
	migrationApplied: true, flagEnabled: false, rpcReachable: true, openMarkets: 2,
	reconcile: { checked: true, ok: true, detail: 'no pools yet (nothing to reconcile)' },
	fee: { feeBps: 300, buybackShareBps: 5000 },
	caps: { usdc: { maxStake: '100000000', maxPool: '5000000000' }, three: { maxStake: '1', maxPool: '2' } },
};

describe('launch plan preflight', () => {
	it('passes when every fact is good', () => {
		expect(renderLaunchPlan(good).ok).toBe(true);
	});
	it('fails on the stock environment with no keys, program or migration', () => {
		const stock = { ...good, programId: null, programHash: null, cluster: 'devnet', authority: null, resolver: null, buybackWallet: null, migrationApplied: false, openMarkets: 0 };
		const failed = evaluatePreflight(stock).filter((c) => !c.ok).map((c) => c.id);
		expect(failed).toEqual(expect.arrayContaining(['cluster', 'program-id', 'program-build', 'keys-present', 'buyback-key', 'keys-distinct', 'migration', 'open-market']));
		expect(renderLaunchPlan(stock).ok).toBe(false);
	});
	it('rejects duplicate keys and economy wallet reuse', () => {
		expect(evaluatePreflight({ ...good, resolver: good.authority }).find((c) => c.id === 'keys-distinct').ok).toBe(false);
		expect(evaluatePreflight({ ...good, authority: ECONOMY_WALLETS[0] }).find((c) => c.id === 'keys-not-economy').ok).toBe(false);
	});
	it('refuses a launch with the flag already on, and with a dirty reconciliation', () => {
		expect(evaluatePreflight({ ...good, flagEnabled: true }).find((c) => c.id === 'flag-off').ok).toBe(false);
		expect(evaluatePreflight({ ...good, reconcile: { checked: true, ok: false, detail: '1 pool(s), 1 mismatched' } }).find((c) => c.id === 'reconcile').ok).toBe(false);
	});
});

describe('launch plan steps', () => {
	it('fills values from facts and requires --confirm-mainnet on every gated CLI command', () => {
		const steps = buildLaunchSteps(good);
		expect(steps.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
		expect(steps[4].run).toContain(good.treasury);
		expect(steps[2].expect).toContain(good.programHash);
		for (const s of steps.filter((x) => x.run.includes('event-markets-stake-admin.mjs'))) expect(s.run).toContain('--confirm-mainnet');
	});
	it('uses update-env-vars, never set-env-vars', () => {
		const text = renderLaunchPlan(good).text;
		expect(text).toContain('--update-env-vars');
		expect(text).not.toContain('--set-env-vars EVENT');
	});
});
