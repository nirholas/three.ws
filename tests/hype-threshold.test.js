import { describe, it, expect } from 'vitest';
import { createHypeDirector, sizeOf } from '../src/game/hype-threshold.js';

const buy = (usd, tx, ts) => ({ tx, ts, isBuy: true, usd, sol: usd / 150 });
const sell = (usd, tx, ts) => ({ tx, ts, isBuy: false, usd, sol: usd / 150 });

// A coin whose ordinary buys sit around `base` dollars, spread over 40 trades.
function backlog(base, n = 40, t0 = 0) {
	return Array.from({ length: n }, (_, i) => buy(base * (0.6 + ((i * 7) % 10) / 12), `b${i}`, t0));
}

describe('hype director threshold', () => {
	it('stays silent until it has enough samples to understand the coin', () => {
		const d = createHypeDirector({ minSamples: 20 });
		expect(d.evaluate(backlog(10, 5), { now: 1000, live: false })).toBeNull();
		expect(d.threshold()).toBeNull();
		expect(d.evaluate([buy(100000, 'huge', 1000)], { now: 1000 })).toBeNull();
	});

	it('scales the bar to the coin: a small coin gets moments at small sizes', () => {
		const small = createHypeDirector();
		const big = createHypeDirector();
		small.evaluate(backlog(3), { now: 0, live: false });
		big.evaluate(backlog(800), { now: 0, live: false });
		expect(small.threshold()).toBeLessThan(40);
		expect(big.threshold()).toBeGreaterThan(2000);
		expect(small.evaluate([buy(45, 'x', 100)], { now: 100 })?.tx).toBe('x');
		expect(big.evaluate([buy(45, 'x', 100)], { now: 100 })).toBeNull();
	});

	it('requires several times the median even when the tail is tight', () => {
		const d = createHypeDirector();
		d.evaluate(Array.from({ length: 40 }, (_, i) => buy(10, `t${i}`, 0)), { now: 0, live: false });
		expect(d.threshold()).toBe(40);
		expect(d.evaluate([buy(39, 'a', 1)], { now: 1 })).toBeNull();
		expect(d.evaluate([buy(41, 'b', 2)], { now: 2 })?.tx).toBe('b');
	});

	it('ignores sells, the backlog, and a stale tape', () => {
		const d = createHypeDirector();
		d.evaluate(backlog(10), { now: 0, live: false });
		expect(d.evaluate([sell(99999, 's', 5)], { now: 5 })).toBeNull();
		expect(d.evaluate([buy(99999, 'bl', 5)], { now: 5, live: false })).toBeNull();
		expect(d.evaluate([buy(99999, 'st', 5)], { now: 5, status: 'stale' })).toBeNull();
		expect(d.evaluate([buy(99999, 'old', 0)], { now: 200_000 })).toBeNull();
	});

	it('picks only the single largest qualifying buy in a batch', () => {
		const d = createHypeDirector();
		d.evaluate(backlog(10), { now: 0, live: false });
		const win = d.evaluate([buy(500, 'm', 10), buy(900, 'big', 10), buy(600, 'n', 10)], { now: 10 });
		expect(win.tx).toBe('big');
		expect(d.isWinner('big')).toBe(true);
		expect(d.isWinner('m')).toBe(false);
	});

	it('honours the cooldown across a volatile minute, then re-arms', () => {
		const d = createHypeDirector({ cooldownMs: 60_000 });
		d.evaluate(backlog(10), { now: 0, live: false });
		expect(d.evaluate([buy(900, 'a', 1000)], { now: 1000 })?.tx).toBe('a');
		expect(d.evaluate([buy(5000, 'b', 2000)], { now: 2000 })).toBeNull();
		expect(d.evaluate([buy(5000, 'c', 59_000)], { now: 59_000 })).toBeNull();
		expect(d.stats().suppressed).toBe(2);
		expect(d.evaluate([buy(5000, 'd', 61_001)], { now: 61_001 })?.tx).toBe('d');
	});

	it('judges a trade against the window as it was before that trade', () => {
		const d = createHypeDirector();
		d.evaluate(Array.from({ length: 40 }, (_, i) => buy(10, `t${i}`, 0)), { now: 0, live: false });
		const batch = Array.from({ length: 30 }, (_, i) => buy(300, `w${i}`, 1));
		expect(d.evaluate(batch, { now: 1 })).not.toBeNull();
	});

	it('keeps USD and native-amount windows apart and bounds memory', () => {
		const d = createHypeDirector({ windowSize: 50 });
		const nativeOnly = Array.from({ length: 80 }, (_, i) => ({ tx: `n${i}`, ts: 0, isBuy: true, usd: null, sol: 1 }));
		d.evaluate(nativeOnly, { now: 0, live: false });
		expect(d.stats().samples).toEqual({ sol: 50 });
		expect(d.threshold('usd')).toBeNull();
		expect(d.threshold('sol')).toBe(4);
	});

	it('sizeOf prefers usd and rejects junk', () => {
		expect(sizeOf({ usd: 12, sol: 1 })).toEqual({ size: 12, unit: 'usd' });
		expect(sizeOf({ usd: null, sol: 2 })).toEqual({ size: 2, unit: 'sol' });
		expect(sizeOf({ usd: NaN, sol: 0 })).toBeNull();
		expect(sizeOf(null)).toBeNull();
	});
});
