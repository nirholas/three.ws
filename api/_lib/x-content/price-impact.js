// What the $THREE price did after each post the account sent.
//
// Pure functions over a chronological candle series ({ t, o, h, l, c, v }, `t` in
// epoch seconds at the bar open, the shape api/_lib/market/ohlcv.js returns), plus
// one loader that pages the series from GeckoTerminal. Used by three consumers
// that must agree on the numbers: scripts/x-archive-price-impact.mjs (the archive
// report and the chart's data file), tests, and the content pipeline's learned
// lifts (outcomes.js).
//
// Two rules keep the returns honest:
//   - No lookahead. A price "at" an instant is the close of the last bar that had
//     finished by then, never a bar still forming.
//   - No interpolation. GeckoTerminal omits bars in which nothing traded. When the
//     last finished bar is older than MAX_STALE_SECONDS, or the horizon lies past
//     the series, that return is null (unavailable), not a guess.

export const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
export const HORIZONS = [
	{ key: 'r1h', seconds: 3600 },
	{ key: 'r4h', seconds: 4 * 3600 },
	{ key: 'r24h', seconds: 24 * 3600 },
];
export const BAR_SECONDS = 900;
// A reference bar this long before the instant is still "the market at that
// moment" for a coin that trades every few minutes; older than this is a gap.
export const MAX_STALE_SECONDS = 3600;
export const PAGE_BARS = 1000;
const MAX_PAGES = 60;

const round = (value, places = 2) => Math.round(value * 10 ** places) / 10 ** places + 0;

// Close of the last bar that had finished by `tSec`, or null across a gap or
// before the series begins. `candles` is ascending by `t`.
export function priceAt(candles, tSec, barSeconds = BAR_SECONDS, maxStale = MAX_STALE_SECONDS) {
	let lo = 0;
	let hi = candles.length - 1;
	let found = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (candles[mid].t + barSeconds <= tSec) {
			found = mid;
			lo = mid + 1;
		} else hi = mid - 1;
	}
	if (found < 0) return null;
	return tSec - (candles[found].t + barSeconds) <= maxStale ? candles[found].c : null;
}

// Returns in percent at each horizon for one instant. A horizon is null when
// either end of it has no price.
export function returnsAt(candles, tSec, opts = {}) {
	const base = priceAt(candles, tSec, opts.barSeconds, opts.maxStale);
	const out = { priceAtPost: base };
	for (const { key, seconds } of HORIZONS) {
		const later = base ? priceAt(candles, tSec + seconds, opts.barSeconds, opts.maxStale) : null;
		out[key] = base && later ? round((later / base - 1) * 100) : null;
	}
	return out;
}

const engagementOf = (post) => (post.likes || 0) + (post.retweets || 0) + (post.replies || 0);

// A post this account wrote as its own: not a repost of someone else, not a
// reply (replies on this account are mostly reply-farming, not announcements).
export const isOwnHeadPost = (post) => post.isOwn && !post.isRetweet && !post.isReply;

export function impactForPosts(posts, candles, opts = {}) {
	return posts
		.filter(isOwnHeadPost)
		.map((post) => {
			const atSec = Math.floor(Date.parse(post.postedAt) / 1000);
			return {
				id: post.tweetId,
				url: post.url,
				postedAt: post.postedAt,
				text: String(post.text || '').replace(/\s+/g, ' ').trim().slice(0, 140),
				engagement: engagementOf(post),
				hasMedia: Boolean(post.hasImage || post.hasVideo),
				...returnsAt(candles, atSec, opts),
			};
		})
		.sort((a, b) => Date.parse(a.postedAt) - Date.parse(b.postedAt));
}

const median = (nums) => {
	if (!nums.length) return null;
	const sorted = [...nums].sort((a, b) => a - b);
	const mid = sorted.length >> 1;
	return round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
};

const mean = (nums) => (nums.length ? round(nums.reduce((a, b) => a + b, 0) / nums.length) : null);

// What an arbitrary moment looks like: every `stepSeconds` across the series, the
// same returns a post would have been given. The comparison a post's return needs
// before it can be called a move: a coin that drifts down 3% a day makes every
// post look bad.
export function baselineReturns(candles, { stepSeconds = 4 * 3600, ...opts } = {}) {
	if (!candles.length) return [];
	const start = candles[0].t + BAR_SECONDS;
	const end = candles[candles.length - 1].t + BAR_SECONDS;
	const rows = [];
	for (let t = start; t <= end; t += stepSeconds) rows.push(returnsAt(candles, t, opts));
	return rows;
}

export function summarize(rows, baseline = []) {
	const summary = { posts: rows.length, horizons: {} };
	for (const { key } of HORIZONS) {
		const known = rows.map((row) => row[key]).filter((v) => v !== null);
		const base = baseline.map((row) => row[key]).filter((v) => v !== null);
		summary.horizons[key] = {
			measured: known.length,
			unavailable: rows.length - known.length,
			median: median(known),
			mean: mean(known),
			positiveShare: known.length ? round(known.filter((v) => v > 0).length / known.length, 3) : null,
			baselineMedian: median(base),
			baselineMean: mean(base),
			baselineSamples: base.length,
		};
	}
	return summary;
}

// The document the Posts view on /oracle-coin reads: the summary, and every post
// that has a $THREE price at the moment it went out. Posts from before the pool
// existed carry no price and are counted in the summary as unavailable instead.
export function buildImpactDocument({ handle, posts, pool, candles, now = Date.now(), mint = THREE_MINT }) {
	const rows = impactForPosts(posts, candles);
	return {
		handle,
		mint,
		pool,
		generatedAt: new Date(now).toISOString(),
		series: {
			barSeconds: BAR_SECONDS,
			from: new Date(candles[0].t * 1000).toISOString(),
			to: new Date((candles[candles.length - 1].t + BAR_SECONDS) * 1000).toISOString(),
			bars: candles.length,
		},
		summary: summarize(rows, baselineReturns(candles)),
		posts: rows.filter((row) => row.priceAtPost !== null),
	};
}

// ── Loading ─────────────────────────────────────────────────────────────────

// The whole 15-minute history of a pool, oldest first, paged back from now with
// GeckoTerminal's before_timestamp until a page comes back short or `fromSec` is
// covered.
export async function loadSeries({ mint = THREE_MINT, fromSec = 0, fetchBars = null, resolvePool = null } = {}) {
	// Loaded on use so the pure functions above (and their tests) carry none of
	// the market layer's cache and network dependencies.
	if (!fetchBars || !resolvePool) {
		const market = await import('../market/ohlcv.js');
		fetchBars = fetchBars || market.fetchOhlcv;
		resolvePool = resolvePool || market.topPoolForToken;
	}
	const pool = await resolvePool(mint, 'solana');
	const byTime = new Map();
	let before = null;
	for (let page = 0; page < MAX_PAGES; page++) {
		const out = await fetchBars({ pool, network: 'solana', timeframe: 'minute', aggregate: 15, limit: PAGE_BARS, beforeTimestamp: before });
		const bars = out.candles || [];
		if (!bars.length) break;
		for (const bar of bars) byTime.set(bar.t, bar);
		const oldest = bars[0].t;
		if (bars.length < PAGE_BARS || oldest <= fromSec || oldest === before) break;
		before = oldest;
	}
	return { pool, candles: [...byTime.values()].sort((a, b) => a.t - b.t) };
}

// The candles the content pipeline stamps its rows with, or null when the market
// layer cannot answer: learning from likes must not stop because a price API did.
export async function loadSeriesOrNull({ days, now = Date.now(), ...rest } = {}) {
	try {
		const { candles } = await loadSeries({ ...rest, fromSec: Math.floor(now / 1000) - days * 86_400 });
		return candles.length ? candles : null;
	} catch {
		return null;
	}
}

// ── Learning from it ────────────────────────────────────────────────────────

// Put each outcome row's +24h price return on the row, keyed by post id, so
// learnLifts can see it. A post with no measured return carries none.
export function attachPriceReturns(rows, impactRows) {
	const byId = new Map((impactRows || []).map((row) => [String(row.id), row]));
	return (rows || []).map((row) => {
		const hit = byId.get(String(row.id));
		return hit && hit.r24h !== null && hit.r24h !== undefined ? { ...row, priceReturn24h: hit.r24h } : row;
	});
}
