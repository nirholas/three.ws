// Hype director: decides when a live buy is large enough, for THIS coin, to earn
// a world-wide celebration, and enforces a strict cooldown so a volatile minute
// cannot strobe the room.
//
// Pure logic, no DOM and no three.js, so it is unit-tested directly
// (tests/hype-threshold.test.js) and shared by the ticker and the market reactor.
//
// Threshold, in two sentences: the bar is the larger of the 95th percentile of
// the coin's recent BUY sizes and FOUR times their median, learned from the trade
// backlog the chart screen already holds (so a coin that normally trades $3 buys
// gets a moment at $40 while a coin that normally trades $800 buys needs several
// thousand), and nothing fires until at least `minSamples` buys have been seen so
// a cold start never celebrates a normal trade. After a moment fires, no other
// can fire for `cooldownMs`, and within one batch only the single largest
// qualifying buy wins.

const DEFAULTS = Object.freeze({
	windowSize: 200,        // recent buys remembered per size unit
	minSamples: 20,         // below this the coin is not yet understood: stay quiet
	quantile: 0.95,         // bar 1: a top-5% buy
	medianMultiple: 4,      // bar 2: and several times the typical buy
	cooldownMs: 60_000,     // strict gap between moments
	maxTradeAgeMs: 90_000,  // an outage replay is history, not live
});

// The size of a trade in the best unit the feed gave us. USD is preferred; some
// feeds omit it, in which case the native amount is compared only with other
// native amounts (windows are kept per unit, never mixed).
export function sizeOf(trade) {
	const usd = Number(trade?.usd);
	if (Number.isFinite(usd) && usd > 0) return { size: usd, unit: 'usd' };
	const sol = Number(trade?.sol);
	if (Number.isFinite(sol) && sol > 0) return { size: sol, unit: 'sol' };
	return null;
}

function quantileOf(sorted, q) {
	if (!sorted.length) return 0;
	const pos = (sorted.length - 1) * q;
	const lo = Math.floor(pos);
	const hi = Math.ceil(pos);
	return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * @param {object} [opts]  overrides for DEFAULTS
 * @returns {{
 *   threshold: (unit?: string) => number|null,
 *   evaluate: (trades: object[], ctx?: {now?: number, live?: boolean, status?: string}) => object|null,
 *   isWinner: (tx: string) => boolean,
 *   stats: () => object,
 * }}
 */
export function createHypeDirector(opts = {}) {
	const cfg = { ...DEFAULTS, ...opts };
	const windows = new Map(); // unit -> number[] (arrival order, capped)
	let lastAt = -Infinity;
	let winnerTx = null;
	let suppressed = 0;

	function windowFor(unit) {
		let w = windows.get(unit);
		if (!w) { w = []; windows.set(unit, w); }
		return w;
	}

	function threshold(unit = 'usd') {
		const w = windows.get(unit);
		if (!w || w.length < cfg.minSamples) return null;
		const sorted = w.slice().sort((a, b) => a - b);
		return Math.max(quantileOf(sorted, cfg.quantile), quantileOf(sorted, 0.5) * cfg.medianMultiple);
	}

	function observe(trade) {
		if (trade?.isBuy !== true) return;
		const s = sizeOf(trade);
		if (!s) return;
		const w = windowFor(s.unit);
		w.push(s.size);
		if (w.length > cfg.windowSize) w.splice(0, w.length - cfg.windowSize);
	}

	function evaluate(trades, ctx = {}) {
		const now = ctx.now ?? Date.now();
		const live = ctx.live !== false && ctx.status !== 'stale';
		let best = null;
		let bestSize = 0;
		if (live && Array.isArray(trades)) {
			// Thresholds are frozen before this batch is learned, so a trade is never
			// judged against a window it already inflated.
			const bars = new Map();
			for (const tr of trades) {
				if (tr?.isBuy !== true) continue;
				if (Number.isFinite(tr.ts) && now - tr.ts > cfg.maxTradeAgeMs) continue;
				const s = sizeOf(tr);
				if (!s) continue;
				if (!bars.has(s.unit)) bars.set(s.unit, threshold(s.unit));
				const bar = bars.get(s.unit);
				if (bar == null || s.size < bar) continue;
				if (!best || s.size > bestSize) { best = tr; bestSize = s.size; }
			}
		}
		if (Array.isArray(trades)) for (const tr of trades) observe(tr);
		if (!best) return null;
		if (now - lastAt < cfg.cooldownMs) { suppressed++; return null; }
		lastAt = now;
		winnerTx = best.tx ?? null;
		return best;
	}

	return {
		threshold,
		evaluate,
		isWinner: (tx) => winnerTx != null && tx === winnerTx,
		stats: () => ({
			samples: Object.fromEntries([...windows].map(([u, w]) => [u, w.length])),
			thresholdUsd: threshold('usd'),
			lastAt: Number.isFinite(lastAt) ? lastAt : null,
			suppressed,
			cooldownMs: cfg.cooldownMs,
		}),
	};
}
