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
				// The excerpt is a label, and the repo bans the long dash glyphs.
				text: String(post.text || '').replace(/[\u2013\u2014]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 140),
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

// The series thinned to one point per `bucketSeconds` (open of the first bar, close
// of the last, volume summed), small enough to ship to the browser with the posts
// so the chart and the bubbles draw from the same prices.
export function downsample(candles, bucketSeconds = 4 * 3600) {
	const out = [];
	for (const bar of candles) {
		const slot = Math.floor(bar.t / bucketSeconds) * bucketSeconds;
		const last = out[out.length - 1];
		if (last && last.t === slot) {
			last.c = bar.c;
			last.v += bar.v || 0;
		} else out.push({ t: slot, o: bar.o, c: bar.c, v: bar.v || 0 });
	}
	return out;
}

// The document the Posts view on /oracle-coin reads: the summary, and every post
// that has a $THREE price at the moment it went out. Posts from before the pool
// existed carry no price and are counted in the summary as unavailable instead.
// Union of candle lists keyed by bar time, later lists winning, oldest first.
export function mergeCandles(...lists) {
	const byTime = new Map();
	for (const list of lists) for (const bar of list || []) byTime.set(bar.t, bar);
	return [...byTime.values()].sort((a, b) => a.t - b.t);
}

const measuredCount = (row) => (row.priceAtPost === null ? 0 : 1) + HORIZONS.filter(({ key }) => row[key] !== null).length;

// Returns a previous run measured for posts the current series no longer covers.
// The keyless price API only serves a rolling window of history, so a post that
// was measured once would otherwise turn unavailable on every later run. Only
// posts older than the series start plus the longest horizon qualify (a recent
// post with no +24h yet is not filled from anywhere), and a previous row
// replaces the fresh one's price fields wholesale, never mixed per horizon.
export function carryForwardRows(rows, previousRows, seriesStartSec) {
	const previous = new Map((previousRows || []).map((row) => [String(row.id), row]));
	const cutoff = seriesStartSec + HORIZONS[HORIZONS.length - 1].seconds + MAX_STALE_SECONDS;
	let carried = 0;
	const out = rows.map((row) => {
		if (Date.parse(row.postedAt) / 1000 >= cutoff) return row;
		const old = previous.get(String(row.id));
		if (!old || measuredCount(old) <= measuredCount(row)) return row;
		carried++;
		const fields = { priceAtPost: old.priceAtPost ?? null };
		for (const { key } of HORIZONS) fields[key] = old[key] ?? null;
		return { ...row, ...fields };
	});
	return { rows: out, carried };
}

// `previous` is the document an earlier run wrote. When it describes the same
// mint and pool, the posts and chart points that predate this run's series are
// kept from it (see carryForwardRows), and `carried` says how many posts were.
export function buildImpactDocument({ handle, posts, pool, candles, now = Date.now(), mint = THREE_MINT, previous = null }) {
	let rows = impactForPosts(posts, candles);
	let points = downsample(candles);
	let carried = 0;
	let from = candles[0].t;
	if (previous && previous.mint === mint && previous.pool === pool) {
		({ rows, carried } = carryForwardRows(rows, previous.posts, candles[0].t));
		const firstSlot = points.length ? points[0].t : Infinity;
		const older = (previous.points || []).filter((point) => point.t < firstSlot);
		points = [...older, ...points];
		if (older.length) from = Math.min(from, older[0].t);
	}
	return {
		handle,
		mint,
		pool,
		generatedAt: new Date(now).toISOString(),
		series: {
			barSeconds: BAR_SECONDS,
			from: new Date(from * 1000).toISOString(),
			to: new Date((candles[candles.length - 1].t + BAR_SECONDS) * 1000).toISOString(),
			bars: candles.length,
		},
		carried,
		summary: summarize(rows, baselineReturns(candles)),
		points,
		posts: rows.filter((row) => row.priceAtPost !== null),
	};
}

// ── Loading ─────────────────────────────────────────────────────────────────

// First wait after a throttled page; each further retry doubles it. GeckoTerminal's
// keyless tier refills its per-minute budget within a minute.
const THROTTLE_BACKOFF_MS = 15_000;

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The whole 15-minute history of a pool, oldest first, paged back from now with
// GeckoTerminal's before_timestamp until a page comes back short or `fromSec` is
// covered. `rateLimitRetries` is how many times one page answered 429 is asked
// again after a doubling backoff. The batch script sets it; request-time callers
// keep the default 0 so a throttle fails fast instead of holding a request open.
// The keyless GeckoTerminal tier answers a request older than its window with
// "You can only access data from the past 180 days" (a 401, tagged 502 by
// ohlcv.js), so the window is read from the message rather than the status.
const isHistoryWindowRefusal = (err) => /\b(?:past|last) \d+ days\b/i.test(String(err?.message || ''));

export async function loadSeries({
	mint = THREE_MINT,
	fromSec = 0,
	fetchBars = null,
	resolvePool = null,
	rateLimitRetries = 0,
	sleep = realSleep,
} = {}) {
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
	let historyLimited = false;
	for (let page = 0; page < MAX_PAGES; page++) {
		const query = { pool, network: 'solana', timeframe: 'minute', aggregate: 15, limit: PAGE_BARS, beforeTimestamp: before };
		let out;
		for (let attempt = 0; ; attempt++) {
			try {
				out = await fetchBars(query);
				break;
			} catch (err) {
				// Paging back past the provider's history window ends the series at
				// what was already read; the posts before it measure as unavailable.
				if (page > 0 && isHistoryWindowRefusal(err)) {
					historyLimited = true;
					break;
				}
				if (err?.status !== 429 || attempt >= rateLimitRetries) throw err;
				await sleep(THROTTLE_BACKOFF_MS * 2 ** attempt);
			}
		}
		if (historyLimited) break;
		const bars = out.candles || [];
		if (!bars.length) break;
		for (const bar of bars) byTime.set(bar.t, bar);
		const oldest = bars[0].t;
		if (bars.length < PAGE_BARS || oldest <= fromSec || oldest === before) break;
		before = oldest;
	}
	return { pool, candles: [...byTime.values()].sort((a, b) => a.t - b.t), historyLimited };
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
