import { describe, it, expect } from 'vitest';
import {
	parsePredicate,
	evalPredicate,
	buildView,
	compileStrategy,
} from '../../examples/skills/pump-fun-strategy/dsl.js';
import {
	validateStrategy,
	backtestStrategy,
} from '../../examples/skills/pump-fun-strategy/handlers.js';

describe('parsePredicate', () => {
	it('parses ops and dotted paths', () => {
		expect(parsePredicate('holders.total > 50')).toMatchObject({ lhs: 'holders.total', op: '>', rhs: 50 });
		expect(parsePredicate('position.pnlPct >= 25%')).toMatchObject({ rhs: 25 });
		expect(parsePredicate('creator.rugCount == 0')).toMatchObject({ op: '==', rhs: 0 });
	});
	it('rejects malformed input', () => {
		expect(() => parsePredicate('garbage')).toThrow();
		expect(() => parsePredicate('a > b')).toThrow();
	});
});

describe('evalPredicate', () => {
	const view = { a: { b: 10 }, n: 0 };
	it('evaluates ops correctly', () => {
		expect(evalPredicate(parsePredicate('a.b > 5'), view)).toBe(true);
		expect(evalPredicate(parsePredicate('a.b < 5'), view)).toBe(false);
		expect(evalPredicate(parsePredicate('a.b == 10'), view)).toBe(true);
		expect(evalPredicate(parsePredicate('n != 1'), view)).toBe(true);
	});
	it('returns false for missing paths instead of throwing', () => {
		expect(evalPredicate(parsePredicate('does.not.exist > 0'), view)).toBe(false);
	});
});

describe('buildView', () => {
	it('handles missing fields without NaN cascade', () => {
		const v = buildView({});
		expect(v.holders.total).toBe(0);
		expect(v.creator.rugCount).toBe(0);
		expect(v.curve.priceSol).toBe(0);
	});
	it('computes pnlPct from entry vs current price', () => {
		const v = buildView({
			curve: { priceSol: 0.0015 },
			position: { entryPriceSol: 0.001, openedAt: Date.now() - 60_000, amountTokens: 1000 },
		});
		expect(v.position.pnlPct).toBeCloseTo(50, 1);
		expect(v.position.ageSec).toBeGreaterThan(50);
	});
});

describe('compileStrategy', () => {
	it('passes/skips based on filters', () => {
		const s = compileStrategy({
			scan: { kind: 'newTokens' },
			filters: ['holders.total > 30', 'creator.rugCount == 0'],
			entry: { side: 'buy', amountSol: 0.05 },
		});
		expect(s.passes(buildView({ holders: { total: 50 }, creator: { rugCount: 0 } }))).toBe(true);
		expect(s.passes(buildView({ holders: { total: 10 }, creator: { rugCount: 0 } }))).toBe(false);
		expect(s.passes(buildView({ holders: { total: 50 }, creator: { rugCount: 1 } }))).toBe(false);
	});
	it('returns first matching exit action', () => {
		const s = compileStrategy({
			scan: { kind: 'newTokens' },
			entry: { side: 'buy', amountSol: 0.05 },
			exit: [
				{ if: 'position.pnlPct > 50', do: { side: 'sell', percent: 50 } },
				{ if: 'holders.topHolderPct > 40', do: { side: 'sell', percent: 100 } },
			],
		});
		const view = buildView({
			holders: { topHolderPct: 60 },
			curve: { priceSol: 0.002 },
			position: { entryPriceSol: 0.001, openedAt: Date.now(), amountTokens: 1 },
		});
		// pnl rule fires first because it's listed first.
		expect(s.shouldExit(view)).toEqual({ side: 'sell', percent: 50 });
	});
	it('throws on missing required fields', () => {
		expect(() => compileStrategy({})).toThrow();
		expect(() => compileStrategy({ scan: {}, })).toThrow();
	});
});

describe('validateStrategy tool', () => {
	it('returns parsed metadata', async () => {
		const r = await validateStrategy({
			strategy: {
				scan: { kind: 'newTokens' },
				filters: ['holders.total > 10'],
				entry: { side: 'buy', amountSol: 0.05 },
				exit: [{ if: 'position.pnlPct > 100', do: { side: 'sell', percent: 100 } }],
			},
		});
		expect(r.ok).toBe(true);
		expect(r.data.filterCount).toBe(1);
		expect(r.data.exitCount).toBe(1);
	});
	it('returns ok:false on bad input', async () => {
		const r = await validateStrategy({ strategy: { scan: { kind: 'x' } } });
		expect(r.ok).toBe(false);
	});
});

describe('backtestStrategy', () => {
	function stubCtx({ holdersTotal = 100, topPct = 10, rugs = 0, prices }) {
		// Build a fake trade timeline from a price array.
		const t0 = 1_700_000_000_000;
		const trades = prices.map((p, i) => ({
			timestamp: t0 + i * 60_000,
			side: 'buy',
			solAmount: p * 1000,
			tokenAmount: 1000,
			priceSol: p,
		}));
		const responses = {
			'pump-fun.getTokenDetails': { creator: 'CREATOR', createdAt: new Date(t0).toISOString() },
			'pump-fun.getTokenHolders': { total: holdersTotal, holders: [{ pct: topPct }] },
			'pump-fun.getBondingCurve': { priceSol: prices[0], graduationPct: 10 },
			'pump-fun.getCreatorProfile': { rugCount: rugs },
			'pump-fun.getTokenTrades': { trades },
		};
		return {
			skills: {
				invoke: async (tool) => ({ ok: true, data: responses[tool] ?? {} }),
			},
		};
	}

	it('takes profit on a winner', async () => {
		const ctx = stubCtx({ prices: [0.001, 0.0012, 0.0016, 0.002] });
		const r = await backtestStrategy({
			strategy: {
				scan: { kind: 'mintList', mints: ['MINT1'] },
				filters: ['holders.total > 50'],
				entry: { side: 'buy', amountSol: 0.1 },
				exit: [{ if: 'position.pnlPct > 50', do: { side: 'sell', percent: 100 } }],
			},
			mints: ['MINT1'],
		}, ctx);
		expect(r.ok).toBe(true);
		expect(r.data.tradeCount).toBe(1);
		expect(r.data.realizedPnlSol).toBeGreaterThan(0);
		expect(r.data.winRate).toBe(1);
	});

	it('skips when filters fail', async () => {
		const ctx = stubCtx({ holdersTotal: 5, prices: [0.001, 0.002] });
		const r = await backtestStrategy({
			strategy: {
				scan: { kind: 'mintList', mints: ['MINT1'] },
				filters: ['holders.total > 50'],
				entry: { side: 'buy', amountSol: 0.1 },
			},
			mints: ['MINT1'],
		}, ctx);
		expect(r.data.tradeCount).toBe(0);
		expect(r.data.spent).toBe(0);
	});

	it('records max drawdown across multiple mints', async () => {
		// First mint loses, second wins.
		let call = 0;
		const ctx = {
			skills: {
				invoke: async (tool) => {
					if (tool === 'pump-fun.getTokenTrades') {
						call++;
						const prices = call === 1 ? [0.001, 0.0005] : [0.001, 0.003];
						return {
							ok: true,
							data: {
								trades: prices.map((p, i) => ({
									timestamp: 1_700_000_000_000 + i * 60_000,
									priceSol: p,
									solAmount: p * 1000,
									tokenAmount: 1000,
								})),
							},
						};
					}
					if (tool === 'pump-fun.getTokenHolders') return { ok: true, data: { total: 100, holders: [{ pct: 10 }] } };
					if (tool === 'pump-fun.getTokenDetails') return { ok: true, data: { creator: 'C' } };
					if (tool === 'pump-fun.getBondingCurve') return { ok: true, data: { priceSol: 0.001 } };
					if (tool === 'pump-fun.getCreatorProfile') return { ok: true, data: { rugCount: 0 } };
					return { ok: true, data: {} };
				},
			},
		};
		const r = await backtestStrategy({
			strategy: {
				scan: { kind: 'mintList', mints: ['L', 'W'] },
				filters: ['holders.total > 50'],
				entry: { side: 'buy', amountSol: 0.1 },
			},
			mints: ['L', 'W'],
		}, ctx);
		expect(r.data.tradeCount).toBe(2);
		expect(r.data.maxDrawdownSol).toBeGreaterThan(0);
	});
});
