// Unit tests for the backtest engine (api/_lib/hood-portfolios-backtest.js).
//
// The engine is pure, so every case here is an exact arithmetic assertion rather
// than a tolerance on live data. The series are constructed to isolate one
// behaviour each: what rebalancing does to a basket that oscillates, what it
// does to one that trends, and what the walk does when a leg is missing a day.

import { describe, it, expect } from 'vitest';
import {
	backtest,
	commonDays,
	maxDrawdownPct,
	volatilityPct,
	walk,
} from '../api/_lib/hood-portfolios-backtest.js';

const series = (prices, start = 1) =>
	prices.map((priceUsd, i) => ({ day: `2026-01-${String(start + i).padStart(2, '0')}`, priceUsd }));

describe('commonDays', () => {
	it('intersects, so a leg missing a day removes that day for everyone', () => {
		const out = commonDays({
			a: series([1, 1, 1, 1]),
			b: [
				{ day: '2026-01-01', priceUsd: 1 },
				{ day: '2026-01-03', priceUsd: 1 },
			],
		});
		expect(out).toEqual(['2026-01-01', '2026-01-03']);
	});

	it('returns nothing when the windows do not overlap at all', () => {
		expect(
			commonDays({
				a: [{ day: '2026-01-01', priceUsd: 1 }],
				b: [{ day: '2026-02-01', priceUsd: 1 }],
			}),
		).toEqual([]);
	});
});

describe('maxDrawdownPct', () => {
	it('is zero for a series that only rises', () => {
		expect(maxDrawdownPct([100, 110, 120])).toBe(0);
	});

	it('measures peak to trough, not start to end', () => {
		// Peaks at 200, falls to 100: a 50% drawdown, even though it ends up.
		expect(maxDrawdownPct([100, 200, 100, 150])).toBeCloseTo(50, 10);
	});
});

describe('volatilityPct', () => {
	it('is zero for a flat series', () => {
		expect(volatilityPct([100, 100, 100, 100])).toBeCloseTo(0, 10);
	});

	it('declines to answer without enough observations', () => {
		expect(volatilityPct([100])).toBeNull();
		expect(volatilityPct([100, 101])).toBeNull();
	});
});

describe('walk', () => {
	const legs = [
		{ address: 'a', weightBps: 5000 },
		{ address: 'b', weightBps: 5000 },
	];

	it('holds value flat when prices do not move', () => {
		const out = walk({ legs, series: { a: series([1, 1, 1]), b: series([2, 2, 2]) }, rebalanceDays: 0 });
		expect(out.values).toEqual([10_000, 10_000, 10_000]);
		expect(out.rebalances).toBe(0);
	});

	it('tracks a 50/50 basket where one leg doubles', () => {
		const out = walk({ legs, series: { a: series([1, 2]), b: series([1, 1]) }, rebalanceDays: 0 });
		// $5k doubles to $10k, $5k stays: $15k.
		expect(out.values[1]).toBeCloseTo(15_000, 6);
	});

	it('renormalises weights across the legs it was given', () => {
		// Two legs at 2500bps each: still a 50/50 basket of what is present.
		const out = walk({
			legs: [
				{ address: 'a', weightBps: 2500 },
				{ address: 'b', weightBps: 2500 },
			],
			series: { a: series([1, 2]), b: series([1, 1]) },
			rebalanceDays: 0,
		});
		expect(out.values[1]).toBeCloseTo(15_000, 6);
	});

	it('counts rebalances on the published cadence', () => {
		const out = walk({
			legs,
			series: { a: series([1, 1, 1, 1, 1]), b: series([1, 1, 1, 1, 1]) },
			rebalanceDays: 2,
		});
		expect(out.rebalances).toBe(2);
	});
});

describe('backtest', () => {
	const legs = [
		{ address: 'a', weightBps: 5000 },
		{ address: 'b', weightBps: 5000 },
	];

	it('shows rebalancing helping a basket that oscillates', () => {
		// The textbook case: two anti-correlated legs that both end where they
		// started. Buy-and-hold returns exactly zero; selling the winner to buy
		// the loser each step harvests the swings.
		const a = series([100, 200, 100, 200, 100]);
		const b = series([100, 50, 100, 50, 100]);
		const out = backtest({ legs, series: { a, b }, rebalanceDays: 1 });

		expect(out.ok).toBe(true);
		expect(out.heldWithoutRebalancing.totalReturnPct).toBeCloseTo(0, 6);
		expect(out.rebalanced.totalReturnPct).toBeGreaterThan(0);
		expect(out.rebalancingAddedPct).toBeGreaterThan(0);
	});

	it('shows rebalancing hurting a basket that trends', () => {
		// The honest other half: when one leg keeps winning, repeatedly selling it
		// to top up the loser costs money. A backtest that could not produce this
		// result would not be measuring anything.
		const a = series([100, 200, 400, 800, 1600]);
		const b = series([100, 100, 100, 100, 100]);
		const out = backtest({ legs, series: { a, b }, rebalanceDays: 1 });

		expect(out.ok).toBe(true);
		expect(out.rebalanced.totalReturnPct).toBeLessThan(out.heldWithoutRebalancing.totalReturnPct);
		expect(out.rebalancingAddedPct).toBeLessThan(0);
	});

	it('reports the window it actually covered', () => {
		const out = backtest({ legs, series: { a: series([1, 1, 1]), b: series([1, 1, 1]) }, rebalanceDays: 0 });
		expect(out.from).toBe('2026-01-01');
		expect(out.to).toBe('2026-01-03');
		expect(out.windowDays).toBe(3);
		expect(out.rebalanced.series).toHaveLength(3);
	});

	it('refuses rather than inventing a result when there is no overlap', () => {
		const out = backtest({
			legs,
			series: { a: [{ day: '2026-01-01', priceUsd: 1 }], b: [{ day: '2026-02-01', priceUsd: 1 }] },
			rebalanceDays: 0,
		});
		expect(out.ok).toBe(false);
		expect(out.reason).toMatch(/overlapping history/);
	});

	it('states that it models no trading costs', () => {
		const out = backtest({ legs, series: { a: series([1, 1]), b: series([1, 1]) }, rebalanceDays: 0 });
		expect(out.costModel).toBe('none');
	});
});
