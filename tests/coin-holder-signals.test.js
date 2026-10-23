import { describe, it, expect, vi } from 'vitest';

vi.mock('../api/_lib/db.js', () => ({ sql: Object.assign(vi.fn(async () => []), {}) }));

const { giniCoefficient, holderGini, firstBuyers, seedingSummary, traceSeeding } = await import(
	'../api/_lib/coin/holder-signals.js'
);
const { holderStats } = await import('../api/pump/token-stats.js');
const { evaluateModel } = await import('../api/_lib/oracle/conviction.js');
const { FEATURES } = await import('../api/_lib/oracle/fit.js');

const THREE = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const h = (wallet, units) => ({ wallet, units: BigInt(units) });

describe('giniCoefficient', () => {
	it('is 0 for equal balances', () => {
		expect(giniCoefficient([5n, 5n, 5n, 5n])).toBe(0);
	});
	it('approaches 1 when one wallet holds nearly everything', () => {
		const g = giniCoefficient([1, 1, 1, 1, 1000]);
		expect(g).toBeGreaterThan(0.75);
		expect(g).toBeLessThanOrEqual(1);
	});
	it('matches a hand-computed value', () => {
		// [1,2,3,4]: (2*(1+4+9+16))/(4*10) - 5/4 = 1.5 - 1.25 = 0.25
		expect(giniCoefficient([4, 1, 3, 2])).toBe(0.25);
	});
	it('is null with fewer than two non-zero balances', () => {
		expect(giniCoefficient([])).toBeNull();
		expect(giniCoefficient([7n])).toBeNull();
		expect(giniCoefficient([0n, 0n, 9n])).toBeNull();
	});
});

describe('holderGini', () => {
	it('excludes the bonding curve and AMM pool and reports the sample size', () => {
		const holders = [h('curve', 800), h('a', 10), h('b', 10), h('pool', 500), h('c', 10)];
		expect(holderGini(holders, { curve: 'curve', pool: 'pool' })).toEqual({ gini: 0, gini_n: 3 });
	});
	it('caps the sample at the top N', () => {
		const holders = Array.from({ length: 80 }, (_, i) => h(`w${i}`, 1000 - i));
		expect(holderGini(holders, { topN: 50 }).gini_n).toBe(50);
	});
	it('is carried on holderStats for the $THREE mint', () => {
		const stats = holderStats([h('curve', 500), h('a', 300), h('b', 100), h('c', 100)], {
			supply: 1000n,
			creator: 'a',
			curve: 'curve',
			pool: null,
			earlyBuyers: null,
		});
		expect(stats.gini_n).toBe(3);
		expect(stats.gini).toBeGreaterThan(0);
		expect(THREE).toMatch(/pump$/);
	});
});

describe('firstBuyers', () => {
	const t = (ts, user, buy = true) => ({ t: ts, user, buy });
	it('takes the earliest distinct buyers, skipping the creator and sells', () => {
		const trades = [t(5, 'c'), t(1, 'dev'), t(2, 'a'), t(3, 'a'), t(4, 'b', false), t(6, 'b')];
		expect(firstBuyers(trades, { creator: 'dev', k: 3 })).toEqual(['a', 'c', 'b']);
	});
});

describe('seedingSummary', () => {
	it('reports the share funded by the single largest shared funder', () => {
		const s = seedingSummary({ a: 'F1', b: 'F1', c: 'F1', d: 'F2' }, { sampled: 5, partial: true });
		expect(s).toMatchObject({ resolved: 4, seeded_share: 0.75, largest_cluster: 3, sampled: 5, partial: true });
	});
	it('is 0 when every buyer has a distinct funder', () => {
		expect(seedingSummary({ a: 'F1', b: 'F2', c: 'F3' }, { sampled: 3, partial: false }).seeded_share).toBe(0);
	});
	it('is null with fewer than three known funders', () => {
		expect(seedingSummary({ a: 'F1', b: 'F1' }, { sampled: 2, partial: false }).seeded_share).toBeNull();
	});
});

describe('traceSeeding', () => {
	it('resolves funders and is not partial when every wallet resolves', async () => {
		const resolve = async (w) => ({ funder: w === 'd' ? 'F2' : 'F1' });
		const out = await traceSeeding(['a', 'b', 'c', 'd'], { endpoint: 'x', resolve });
		expect(out).toMatchObject({ seeded_share: 0.75, partial: false });
	});
	it('returns partial when the budget runs out before every wallet resolves', async () => {
		const resolve = (w) => new Promise((r) => setTimeout(() => r({ funder: 'F1' }), w === 'slow' ? 500 : 0));
		const out = await traceSeeding(['a', 'b', 'c', 'slow'], { endpoint: 'x', resolve, budgetMs: 100 });
		expect(out.partial).toBe(true);
		expect(out.resolved).toBe(3);
	});
	it('counts a wallet whose lookup throws as unresolved', async () => {
		const resolve = async (w) => {
			if (w === 'bad') throw new Error('rpc down');
			return { funder: 'F1' };
		};
		const out = await traceSeeding(['a', 'b', 'c', 'bad'], { endpoint: 'x', resolve });
		expect(out.partial).toBe(true);
		expect(out.seeded_share).toBe(1);
	});
});

describe('oracle features', () => {
	it('registers both features for fitting', () => {
		const keys = FEATURES.map((f) => f.key);
		expect(keys).toContain('holder_gini');
		expect(keys).toContain('seeded_share');
	});
	it('scores intel carrying the new signals without error', () => {
		const out = evaluateModel({ launch: { holder_gini: 0.9, seeded_share: 0.7 } });
		expect(Number.isFinite(out.p)).toBe(true);
	});
});
