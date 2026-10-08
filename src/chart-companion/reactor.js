// The Chart Companion's reaction engine: real swaps in, avatar reactions out.
//
// Pure and DOM-free so it can be tested against recorded trade frames. The page
// feeds it every fresh swap from /api/pump/dex-trades and the day's candles from
// /api/pump/price-history; it answers with what the avatar should do (a clip
// from the shared animation library, a facial emotion, and one line to say).
//
// Thresholds are relative to the coin's own tape, never absolute: a $300 buy is
// noise on a coin doing $5M a day and a whale on one doing $20K. A trade is
// "big" or "whale" against the rolling median of recent trade sizes, with a
// dollar floor so a dead tape of $2 trades never cries whale.
//
// Every line is built from the trade that caused it. Nothing here predicts,
// recommends, or invents a number: the companion narrates what just happened.

export const WINDOW = 60; // trades kept for the rolling median
const MIN_SAMPLE = 8; // below this the median is not trusted; floors decide alone
const BIG_MULT = 3;
const WHALE_MULT = 8;
export const BIG_FLOOR_USD = 150;
export const WHALE_FLOOR_USD = 1000;
export const STREAK = 5;
export const QUIET_MS = 120_000;
const HIGH_COOLDOWN_MS = 60_000;

/**
 * What each reaction does. `clip` names a clip in /animations/manifest.json;
 * `holdMs` is set only for looping clips, which the page must end itself.
 * Higher `priority` interrupts lower.
 */
export const REACTION_KINDS = {
	whaleBuy: { priority: 5, clip: 'av-superhero-jump', emotion: ['celebration', 1] },
	whaleSell: { priority: 5, clip: 'defeated', emotion: ['concern', 1] },
	newHigh: { priority: 4, clip: 'av-brag-claps', emotion: ['celebration', 0.9] },
	bigBuy: { priority: 3, clip: 'celebrate', emotion: ['celebration', 0.7] },
	bigSell: { priority: 3, clip: 'facepalm', emotion: ['concern', 0.7] },
	buyStreak: { priority: 2, clip: 'dance', holdMs: 6000, emotion: ['celebration', 0.6] },
	sellStreak: { priority: 2, clip: 'shrug', emotion: ['concern', 0.5] },
	greeting: { priority: 1, clip: 'wave', emotion: ['curiosity', 0.6] },
	quiet: { priority: 1, clip: 'think', emotion: ['patience', 0.5] },
};

const LINES = {
	whaleBuy: [
		(c) => `Whale alert. ${c.usd} buy on ${c.sym}.`,
		(c) => `Somebody just bought ${c.usd} of ${c.sym} in one swap.`,
		(c) => `${c.usd} in a single buy. ${c.sym} has company.`,
	],
	whaleSell: [
		(c) => `Big exit. ${c.usd} of ${c.sym} just sold.`,
		(c) => `A whale took ${c.usd} off the table.`,
		(c) => `${c.usd} sell on ${c.sym}. That one hurt.`,
	],
	newHigh: [
		(c) => `${c.sym} just printed a new 24-hour high at ${c.price}.`,
		(c) => `New high of the day for ${c.sym}: ${c.price}.`,
	],
	bigBuy: [
		(c) => `${c.usd} buy. Nice.`,
		(c) => `Solid ${c.usd} buy on ${c.sym}.`,
		(c) => `Buyer stepping in with ${c.usd}.`,
	],
	bigSell: [
		(c) => `${c.usd} sell. Somebody blinked.`,
		(c) => `${c.usd} just left ${c.sym}.`,
		(c) => `Seller out for ${c.usd}.`,
	],
	buyStreak: [
		(c) => `${c.n} buys in a row on ${c.sym}.`,
		(c) => `Buy streak. ${c.n} straight.`,
	],
	sellStreak: [
		(c) => `${c.n} sells in a row. Rough stretch.`,
		(c) => `Sellers have the last ${c.n} swaps.`,
	],
	greeting: [
		(c) => (c.change == null
			? `Watching ${c.sym} live. I will call out every big trade.`
			: `${c.sym} is ${c.change} over 24 hours. I will call out every big trade.`),
	],
	quiet: [
		(c) => `Quiet on ${c.sym}. Watching the chart.`,
		(c) => `No swaps for a couple of minutes on ${c.sym}.`,
	],
};

/** "$1.2K", "$430", "$3.4M". */
export function fmtUsd(n) {
	const v = Math.abs(Number(n) || 0);
	if (v >= 1e6) return `$${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`;
	if (v >= 1e3) return `$${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}K`;
	return `$${v.toFixed(0)}`;
}

/** Token price with enough significant digits for sub-cent memecoins. */
export function fmtPrice(p) {
	const v = Number(p);
	if (!Number.isFinite(v) || v <= 0) return '';
	if (v >= 1) return `$${v.toFixed(v >= 100 ? 0 : 2)}`;
	return `$${v.toPrecision(3)}`;
}

/** "+12.4%" / "-3.1%". */
export function fmtPct(p) {
	const v = Number(p);
	if (!Number.isFinite(v)) return '';
	return `${v >= 0 ? '+' : ''}${v.toFixed(Math.abs(v) >= 10 ? 0 : 1)}%`;
}

function median(xs) {
	if (!xs.length) return 0;
	const s = [...xs].sort((a, b) => a - b);
	const m = s.length >> 1;
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** USD price per token implied by one swap, or null when the trade cannot say. */
export function tradePrice(t) {
	const usd = Number(t?.sol_value_usd);
	const amt = Number(t?.token_amount);
	return usd > 0 && amt > 0 ? usd / amt : null;
}

/**
 * @param {{ symbol?: string, now?: () => number }} [opts]
 */
export function createReactor({ symbol = '', now = () => Date.now() } = {}) {
	const sym = symbol ? `$${String(symbol).replace(/^\$/, '').toUpperCase()}` : 'this coin';
	const sizes = [];
	const lineIdx = {};
	let high24 = null;
	let open24 = null;
	let lastHighAt = -Infinity;
	let lastTradeAt = now();
	let lastQuietAt = -Infinity;
	let streakSide = null;
	let streakLen = 0;
	let streakFired = false;

	const stats = { buys: 0, sells: 0, buyUsd: 0, sellUsd: 0, biggest: null, lastPrice: null, change24: null };

	function react(kind, ctx = {}) {
		const pool = LINES[kind];
		const i = lineIdx[kind] = ((lineIdx[kind] ?? -1) + 1) % pool.length;
		const spec = REACTION_KINDS[kind];
		return {
			kind,
			priority: spec.priority,
			clip: spec.clip,
			holdMs: spec.holdMs || 0,
			emotion: spec.emotion,
			line: pool[i]({ sym, ...ctx }),
			trade: ctx.trade || null,
			at: now(),
		};
	}

	/** Seed the day's range from 15m candles (oldest first, `{ o, h, l, c }`). */
	function ingestCandles(candles) {
		const rows = (Array.isArray(candles) ? candles : []).filter((c) => Number(c?.h) > 0);
		if (!rows.length) return;
		const day = rows.slice(-96); // 96 x 15m = 24h
		high24 = Math.max(...day.map((c) => Number(c.h)));
		open24 = Number(day[0].o) || null;
		const last = Number(day[day.length - 1].c);
		if (last > 0) {
			stats.lastPrice = last;
			stats.change24 = open24 ? ((last - open24) / open24) * 100 : null;
		}
	}

	function greeting() {
		return react('greeting', { change: stats.change24 == null ? null : fmtPct(stats.change24) });
	}

	function classify(t) {
		const usd = Number(t.sol_value_usd) || 0;
		const med = sizes.length >= MIN_SAMPLE ? median(sizes) : 0;
		const ctx = { usd: fmtUsd(usd), trade: t };
		const price = tradePrice(t);
		const out = [];

		if (usd >= Math.max(WHALE_FLOOR_USD, WHALE_MULT * med)) out.push(react(t.is_buy ? 'whaleBuy' : 'whaleSell', ctx));
		else if (usd >= Math.max(BIG_FLOOR_USD, BIG_MULT * med)) out.push(react(t.is_buy ? 'bigBuy' : 'bigSell', ctx));

		if (price != null) {
			stats.lastPrice = price;
			if (open24) stats.change24 = ((price - open24) / open24) * 100;
			if (high24 != null && t.is_buy && price > high24) {
				high24 = price;
				if (now() - lastHighAt >= HIGH_COOLDOWN_MS) {
					lastHighAt = now();
					out.push(react('newHigh', { ...ctx, price: fmtPrice(price) }));
				}
			}
		}

		const side = t.is_buy ? 'buy' : 'sell';
		if (side === streakSide) streakLen += 1;
		else { streakSide = side; streakLen = 1; streakFired = false; }
		if (streakLen >= STREAK && !streakFired) {
			streakFired = true;
			out.push(react(t.is_buy ? 'buyStreak' : 'sellStreak', { ...ctx, n: streakLen }));
		}

		sizes.push(usd);
		if (sizes.length > WINDOW) sizes.shift();
		return out;
	}

	/**
	 * Feed fresh swaps (any order). Updates the running stats and returns the
	 * reactions they earned, highest priority first.
	 */
	function ingestTrades(trades) {
		const fresh = (Array.isArray(trades) ? trades : [])
			.filter((t) => t && Number(t.sol_value_usd) >= 0)
			.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
		const out = [];
		for (const t of fresh) {
			const usd = Number(t.sol_value_usd) || 0;
			if (t.is_buy) { stats.buys += 1; stats.buyUsd += usd; } else { stats.sells += 1; stats.sellUsd += usd; }
			if (!stats.biggest || usd > Number(stats.biggest.sol_value_usd)) stats.biggest = t;
			out.push(...classify(t));
		}
		if (fresh.length) lastTradeAt = now();
		return out.sort((a, b) => b.priority - a.priority);
	}

	/** Called on a timer: a quiet-tape line, at most once per quiet stretch. */
	function tick() {
		const t = now();
		if (t - lastTradeAt < QUIET_MS || lastQuietAt > lastTradeAt) return null;
		lastQuietAt = t;
		return react('quiet');
	}

	/**
	 * Take in the backlog a page sees on load. It counts toward the stats and
	 * the size window like any swap, and its notable trades come back as
	 * reactions stamped with their own trade time, oldest first, so the feed
	 * opens on what already happened. The caller lists them; it does not
	 * perform them, because cheering a swap from ten minutes ago is noise.
	 */
	function prime(trades) {
		const out = ingestTrades(trades)
			.map((r) => (r.trade?.timestamp ? { ...r, at: r.trade.timestamp * 1000 } : r))
			.sort((a, b) => a.at - b.at);
		lastTradeAt = now();
		return out;
	}

	return { ingestCandles, ingestTrades, tick, prime, greeting, stats, get symbol() { return sym; } };
}
