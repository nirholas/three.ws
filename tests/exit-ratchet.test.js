import { describe, it, expect } from 'vitest';
import {
	evaluateRatchet, ratchetStop, normalizeRatchet, reasonCodeForGuard, REASON_CODES,
} from '../api/_lib/exit-ratchet.js';
import { normalizeOrder, describeOrder, ORDER_TYPES } from '../api/_lib/orders.js';
import { nextFire } from '../api/_lib/order-book.js';

const THREE = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
// Entry 100. Wide 30% stop = 70. +50% arms a lock at +10% (110); +100% arms +50% (150); +200% arms +120% (220).
const ratchet = {
	initial_stop_pct: 30,
	tiers: [
		{ profit_pct: 50, lock_pct: 10 },
		{ profit_pct: 100, lock_pct: 50 },
		{ profit_pct: 200, lock_pct: 120 },
	],
};

describe('evaluateRatchet table', () => {
	const rows = [
		// name, peak, value, fire, code, stop, tier
		['phase 1 holds above the wide stop', 100, 80, false, null, 70, null],
		['phase 1 holds exactly at the stop boundary + 1', 100, 70.01, false, null, 70, null],
		['phase 1 exits at the wide stop', 100, 70, true, 'DRAWDOWN', 70, null],
		['phase 1 exits below the wide stop', 100, 40, true, 'DRAWDOWN', 70, null],
		['peak below tier 1 trigger keeps phase 1', 149, 100, false, null, 70, null],
		['tier 1 arms at +50% and floor rises to 110', 150, 140, false, null, 110, 0],
		['tier 1 locks: falls to the lock', 150, 110, true, 'TIER_LOCK', 110, 0],
		['tier 1 locks: falls under the lock', 160, 100, true, 'TIER_LOCK', 110, 0],
		['tier 2 arms at +100%', 200, 151, false, null, 150, 1],
		['tier 2 locks', 200, 150, true, 'TIER_LOCK', 150, 1],
		['stop never falls back to tier 1 after tier 2 armed', 200, 120, true, 'TIER_LOCK', 150, 1],
		['tier 3 arms at +200%', 300, 230, false, null, 220, 2],
		['tier 3 locks', 300, 219, true, 'TIER_LOCK', 220, 2],
		['gap-down from the peak through two lock tiers fires', 300, 90, true, 'TIER_LOCK', 220, 2],
		['gap-down straight through tier 1 lock fires with TIER_LOCK', 150, 60, true, 'TIER_LOCK', 110, 0],
		['value above peak raises the peak, stop follows', 100, 210, false, null, 150, 1],
	];
	for (const [name, peak, value, fire, code, stop, tier] of rows) {
		it(name, () => {
			const r = evaluateRatchet({ entry: 100, peak, value, ratchet });
			expect(r.fire).toBe(fire);
			expect(r.code).toBe(code);
			expect(r.stop).toBeCloseTo(stop, 8);
			expect(r.tier).toBe(tier);
		});
	}

	it('a stale peak below the entry is clamped up to the entry', () => {
		expect(ratchetStop({ entry: 100, peak: 10, ratchet }).stop).toBeCloseTo(70, 8);
	});

	it('the stop is monotonic in the peak', () => {
		let last = -Infinity;
		for (let peak = 100; peak <= 400; peak += 5) {
			const { stop } = ratchetStop({ entry: 100, peak, ratchet });
			expect(stop).toBeGreaterThanOrEqual(last);
			last = stop;
		}
	});

	it('a negative lock above the initial stop still raises the floor in phase 2', () => {
		const r = { initial_stop_pct: 40, tiers: [{ profit_pct: 20, lock_pct: -10 }] };
		expect(ratchetStop({ entry: 100, peak: 125, ratchet: r })).toMatchObject({ stop: 90, phase: 2, code: 'TIER_LOCK' });
	});

	it('holds on a missing value or entry', () => {
		expect(evaluateRatchet({ entry: 100, peak: 100, value: NaN, ratchet }).fire).toBe(false);
		expect(evaluateRatchet({ entry: 0, peak: 100, value: 50, ratchet }).fire).toBe(false);
	});
});

describe('normalizeRatchet', () => {
	it('accepts a valid spec', () => {
		expect(normalizeRatchet(ratchet).ok).toBe(true);
	});
	it.each([
		['no object', null],
		['no tiers', { initial_stop_pct: 30, tiers: [] }],
		['bad initial stop', { initial_stop_pct: 100, tiers: [{ profit_pct: 10, lock_pct: 1 }] }],
		['lock at or above its trigger', { initial_stop_pct: 30, tiers: [{ profit_pct: 10, lock_pct: 10 }] }],
		['non ascending tiers', { initial_stop_pct: 30, tiers: [{ profit_pct: 50, lock_pct: 10 }, { profit_pct: 40, lock_pct: 20 }] }],
		['lock below the initial stop', { initial_stop_pct: 30, tiers: [{ profit_pct: 50, lock_pct: -35 }] }],
		['too many tiers', { initial_stop_pct: 30, tiers: Array.from({ length: 9 }, (_, i) => ({ profit_pct: 10 + i, lock_pct: i })) }],
	])('rejects %s', (_n, raw) => {
		expect(normalizeRatchet(raw).ok).toBe(false);
	});
});

describe('reason codes', () => {
	it('maps guard reasons onto stable codes', () => {
		expect(reasonCodeForGuard('daily_loss_limit')).toBe('DAILY_LOSS');
		expect(reasonCodeForGuard('price_impact')).toBe('IMPACT');
		expect(reasonCodeForGuard('kill_switch')).toBeNull();
		expect(Object.keys(REASON_CODES).sort()).toEqual(['DAILY_LOSS', 'DRAWDOWN', 'IMPACT', 'TIER_LOCK']);
	});
});

describe('trail_ratchet orders', () => {
	const base = { type: 'trail_ratchet', side: 'sell', mint: THREE, sell_pct: 100, ratchet, entry_price: 100 };
	it('is a registered order type', () => {
		expect(ORDER_TYPES).toContain('trail_ratchet');
	});
	it('normalizes, carries the entry, and reads back in words', () => {
		const r = normalizeOrder(base);
		expect(r.ok).toBe(true);
		expect(r.order.entry_price).toBe(100);
		expect(r.order.ratchet.tiers).toHaveLength(3);
		expect(describeOrder({ ...r.order, symbol: 'THREE' })).toMatch(/Ratcheting stop: sell .* if it falls 30% below entry/);
	});
	it('is sell only', () => {
		expect(normalizeOrder({ ...base, side: 'buy', size_sol: 1 }).error).toBe('invalid_side');
	});
	it('rejects a bad ratchet and a bad entry', () => {
		expect(normalizeOrder({ ...base, ratchet: { initial_stop_pct: 30, tiers: [] } }).error).toBe('invalid_ratchet');
		expect(normalizeOrder({ ...base, entry_price: -1 }).error).toBe('invalid_price');
	});
	it('the order book explains when it acts', () => {
		const o = { ...normalizeOrder(base).order, status: 'active', hold_until: null };
		expect(nextFire(o).label).toMatch(/30% under entry/);
	});
});
