// GET /api/pump/price-history?mint=<mint>&interval=15m&from=<unix>&to=<unix>
// --------------------------------------------------------------------------
// OHLCV proxy with automatic fallback chain:
//   1. Birdeye (paid, quota-limited)  — best data quality
//   2. GeckoTerminal (free, no key), pool lookup then candles, through the
//      shared OHLCV ladder (Birdeye pair candles behind it, 24h last-good copy
//      in the shared cache), on an aggregate GeckoTerminal accepts
//   3. Candles built from the coin's own Solana trades (bonding curve, then the
//      canonical pool). GeckoTerminal indexes a new pump.fun coin only once it
//      trades enough, so a young three.ws launch had a live, trading market and
//      still rendered "no price history". This rung used to be pump.fun's
//      candle API, retired on 2026-11-25.
//   4. The last good candles for this mint+interval, served as `stale: true`
//
// On any upstream failure the next source is tried transparently.
// Never fabricates candles.
//
// Chart clients poll with a live `to` (= now) and a rolling `from`, so a cache
// keyed on the raw timestamps never hits: two polls a second apart are two keys.
// That turned every poll into a fresh GeckoTerminal round-trip, and its free
// tier rate-limits under that load — the observed intermittent 502s on /terminal
// and /trades. The window is therefore snapped to the interval's own candle
// boundary before it is used as a cache key *and* before it is sent upstream:
// candles already land on those boundaries, so the response is identical while
// every poll inside one candle shares a single cache entry.
//
// Response: { data: [ { t, o, h, l, c, v } ], source?: 'birdeye'|'gecko'|'onchain', stale?: true }

import { PublicKey } from '@solana/web3.js';

import { cors, json, method, wrap, error, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { fetchBirdeyeOhlcv, birdeyeConfigured } from '../_lib/birdeye.js';
import { topPoolForToken, fetchOhlcv } from '../_lib/market/ohlcv.js';

const VALID_INTERVALS = new Set([
	'1m',
	'3m',
	'5m',
	'15m',
	'30m',
	'1H',
	'2H',
	'4H',
	'6H',
	'8H',
	'12H',
	'1D',
	'3D',
	'1W',
	'1M',
]);

// Birdeye uses uppercase hour/day codes (1H, 1D). Accept the common lowercase
// forms from the client and normalize so callers don't have to care.
function normalizeInterval(raw) {
	if (!raw) return '15m';
	const map = {
		'1h': '1H',
		'2h': '2H',
		'4h': '4H',
		'6h': '6H',
		'8h': '8H',
		'12h': '12H',
		'1d': '1D',
		'3d': '3D',
		'1w': '1W',
	};
	const v = map[raw] || raw;
	return VALID_INTERVALS.has(v) ? v : '15m';
}

function isPlausibleMint(s) {
	return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
}

// Seconds per candle for each normalized interval — the granularity the request
// window is snapped to. Exported for the unit tests.
const INTERVAL_SECONDS = {
	'1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
	'1H': 3600, '2H': 7200, '4H': 14_400, '6H': 21_600, '8H': 28_800, '12H': 43_200,
	'1D': 86_400, '3D': 259_200, '1W': 604_800, '1M': 2_592_000,
};

export function intervalSeconds(interval) {
	return INTERVAL_SECONDS[interval] ?? 900;
}

// `to` is snapped to this bucket rather than to the candle width: snapping it to
// the candle would drop the still-forming candle and freeze a 5m chart for up to
// five minutes. Aligning it with the fresh-cache TTL instead means every poll in
// one TTL window shares a key (so at most one upstream call per TTL) while the
// live candle stays live.
export const POLL_BUCKET_SECONDS = 30;

// Snap a request window so consecutive polls collapse onto one cache key.
// `from` (a rolling window start) rounds down to the candle boundary — candles
// land there anyway, so the served data is unchanged. `to` rounds down to the
// poll bucket. Both round *down*, so the window never asks for less than the
// caller wanted and never reaches into the future.
export function snapWindow({ interval, from, to }) {
	const step = intervalSeconds(interval);
	const snappedTo = Math.floor(to / POLL_BUCKET_SECONDS) * POLL_BUCKET_SECONDS;
	const snappedFrom = Math.floor(from / step) * step;
	// A window narrower than one candle would snap to zero width; keep one candle.
	return snappedFrom >= snappedTo
		? { from: snappedTo - step, to: snappedTo }
		: { from: snappedFrom, to: snappedTo };
}

// ──────────────────────────────────────────────────────────────────────────────
// GeckoTerminal rung, through the shared OHLCV ladder in _lib/market/ohlcv.js.
// Step 1: resolve the top liquidity pool for the token.
// Step 2: fetch that pool's candles (GeckoTerminal, then Birdeye's pair OHLCV,
//         with a 24h last-good copy in the shared cache behind both).
// ──────────────────────────────────────────────────────────────────────────────

// GeckoTerminal only accepts aggregate 1/5/15 for minutes, 1/4/12 for hours and
// 1 for days; anything else is a 400 on every call. Each interval therefore
// maps to [timeframe, aggregate GeckoTerminal accepts, base candles per bucket],
// and the base candles are folded up to the requested width.
const GECKO_INTERVALS = {
	'1m': ['minute', 1, 1],
	'3m': ['minute', 1, 3],
	'5m': ['minute', 5, 1],
	'15m': ['minute', 15, 1],
	'30m': ['minute', 15, 2],
	'1H': ['hour', 1, 1],
	'2H': ['hour', 1, 2],
	'4H': ['hour', 4, 1],
	'6H': ['hour', 1, 6],
	'8H': ['hour', 4, 2],
	'12H': ['hour', 12, 1],
	'1D': ['day', 1, 1],
	'3D': ['day', 1, 3],
	'1W': ['day', 1, 7],
	'1M': ['day', 1, 30],
};

export function geckoParams(interval) {
	return GECKO_INTERVALS[interval] || GECKO_INTERVALS['15m'];
}

// A token's top pool does not change between polls, so resolving it once per
// mint halves the GeckoTerminal calls a chart poll costs — the difference
// between staying inside its free rate limit and tripping it.
const _poolCache = new Map(); // mint → { address, expiresAt }
const POOL_TTL_MS = 10 * 60_000;

// Concurrency gate for outbound GeckoTerminal calls — bounds how many of OUR
// OWN requests are in flight at once. /terminal, /trades, and /pump-dashboard
// each mount several chart widgets that poll different mints simultaneously,
// so a single page load is itself a burst; without this gate that burst alone
// can spend the free tier's per-minute budget before any external traffic is
// involved. Excess callers queue briefly rather than firing in parallel.
const GECKO_MAX_CONCURRENT = 4;
let _geckoActive = 0;
const _geckoQueue = [];

function withGeckoSlot(fn) {
	return new Promise((resolve, reject) => {
		const run = () => {
			_geckoActive++;
			Promise.resolve()
				.then(fn)
				.then(resolve, reject)
				.finally(() => {
					_geckoActive--;
					_geckoQueue.shift()?.();
				});
		};
		if (_geckoActive < GECKO_MAX_CONCURRENT) run();
		else _geckoQueue.push(run);
	});
}

// Thrown when the token genuinely has no market to chart — an honest empty
// state, not an upstream outage, so it must never be retried or served stale.
class NoPoolError extends Error {}

// The pool lookup goes through the shared resolver in api/_lib/market/ohlcv.js
// (GeckoTerminal, then DexScreener's deepest pair, then Birdeye markets, with a
// shared last-good copy) rather than a second GeckoTerminal call of our own.
// The Birdeye rung above already ran that same resolver for this mint, and its
// GeckoTerminal reads are memoized per URL, so this lookup normally costs no
// request at all. It used to re-ask GeckoTerminal for the identical pools URL a
// few milliseconds later; on the shared Cloud Run egress that second call drew
// 429s, the throttle read as an outage, and a coin with no market anywhere got
// a 502 instead of the honest no_market answer (reproduced 2026-10-08).
async function fetchGeckoPoolAddress(mint) {
	const hit = _poolCache.get(mint);
	if (hit && hit.expiresAt > Date.now()) return hit.address;

	let address;
	try {
		address = await withGeckoSlot(() => topPoolForToken(mint, 'solana'));
	} catch (err) {
		// 404 = no source indexes a market for this token: an answer, not an
		// outage. Any other status is a real upstream fault and must bubble so the
		// caller can fall back to the next rung or to stale data.
		if (err?.status === 404) {
			_poolCache.set(mint, { address: null, expiresAt: Date.now() + POOL_TTL_MS });
			return null;
		}
		throw err;
	}
	_poolCache.set(mint, { address: address || null, expiresAt: Date.now() + POOL_TTL_MS });
	if (_poolCache.size > 512) _poolCache.delete(_poolCache.keys().next().value);
	return address || null;
}

// The ladder's source names, in this endpoint's response vocabulary.
const LADDER_SOURCE = { geckoterminal: 'gecko', birdeye: 'birdeye' };

// `live` (the window ends now) asks for the newest candles, a request every
// chart and consumer of that pool shares one cache entry for, and so one
// last-good copy that survives a GeckoTerminal throttle on any instance. A
// historical window pages back with before_timestamp instead.
async function fetchGeckoOhlcv({ mint, interval, from, to, live }) {
	const poolAddress = await fetchGeckoPoolAddress(mint);
	if (!poolAddress) throw new NoPoolError('No pool found on GeckoTerminal for this mint');

	const [timeframe, aggregate, factor] = geckoParams(interval);
	const out = await withGeckoSlot(() =>
		fetchOhlcv({ pool: poolAddress, network: 'solana', timeframe, aggregate, limit: 1000, beforeTimestamp: live ? null : to + 1 }),
	);
	const base = (out?.candles || []).filter((d) => Number.isFinite(d.t) && Number.isFinite(d.c));
	const candles = factor > 1 ? aggregateCandles(base, intervalSeconds(interval)) : base;
	return {
		data: candles.filter((d) => d.t >= from && d.t <= to),
		source: LADDER_SOURCE[out?.source] || 'gecko',
	};
}

// ──────────────────────────────────────────────────────────────────────────────
// On-chain candles: the rung that knows a coin from its first trade.
// pump.fun's candle API used to fill this role, but pump.fun retired every
// candle route on 2026-11-25 (swap-api /v1 404, /v2 410). The coin's own Solana
// trades (bonding curve before graduation, the canonical pool after) are the
// authoritative record anyway, so candles are built from them: the newest
// pages are walked back until they reach the window start or the history ends.
// ──────────────────────────────────────────────────────────────────────────────
const CHAIN_CANDLE_PAGE = 50;
// Each page is up to 60 transaction reads on the RPC, so the walk is bounded.
// A young curve coin (what this rung exists for) fits well inside it; a longer
// window on a busy coin charts its most recent trades.
const CHAIN_CANDLE_MAX_PAGES = 4;

/**
 * Folds consecutive candles into buckets of `width` seconds aligned to the Unix
 * epoch, the same alignment every other source uses. Exported for the tests.
 */
export function aggregateCandles(candles, width) {
	const out = [];
	for (const c of candles) {
		const t = Math.floor(c.t / width) * width;
		const last = out[out.length - 1];
		if (last && last.t === t) {
			last.h = Math.max(last.h, c.h);
			last.l = Math.min(last.l, c.l);
			last.c = c.c;
			last.v += c.v;
		} else {
			out.push({ t, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v });
		}
	}
	return out;
}

/**
 * Buckets trade rows (unix-second `timestamp`, `priceUsd`, `amountUsd`) into
 * epoch-aligned OHLCV of `width` seconds, oldest first. A row with no USD price
 * is skipped; one with no USD amount adds nothing to volume. Exported for the tests.
 */
export function candlesFromTrades(rows, width) {
	const trades = (Array.isArray(rows) ? rows : [])
		.map((r) => ({ t: Number(r?.timestamp), p: Number(r?.priceUsd), v: Number(r?.amountUsd) || 0 }))
		.filter((r) => Number.isFinite(r.t) && r.t > 0 && Number.isFinite(r.p) && r.p > 0)
		.sort((a, b) => a.t - b.t);
	const out = [];
	for (const { t: ts, p, v } of trades) {
		const t = Math.floor(ts / width) * width;
		const last = out[out.length - 1];
		if (last && last.t === t) {
			last.h = Math.max(last.h, p);
			last.l = Math.min(last.l, p);
			last.c = p;
			last.v += v;
		} else {
			out.push({ t, o: p, h: p, l: p, c: p, v });
		}
	}
	return out;
}

function isSolanaKey(mint) {
	try {
		return new PublicKey(mint).toBytes().length === 32;
	} catch {
		return false;
	}
}

async function fetchChainOhlcv({ mint, interval, from, to }) {
	if (!isSolanaKey(mint)) throw new NoPoolError('not a Solana address');
	const { fetchChainTradePage } = await import('../_lib/pump-chain-trades.js');
	const rows = [];
	let before = null;
	for (let i = 0; i < CHAIN_CANDLE_MAX_PAGES; i += 1) {
		const page = await fetchChainTradePage(mint, { limit: CHAIN_CANDLE_PAGE, before });
		// A failed read is an outage, never "no market".
		if (!page) throw new Error('on-chain trades unavailable');
		rows.push(...page.rows);
		const oldest = page.rows[page.rows.length - 1]?.timestamp;
		if (!page.hasMore || !page.cursor || (Number.isFinite(oldest) && oldest < from)) break;
		before = page.cursor;
	}
	if (!rows.length) throw new NoPoolError('no pump.fun curve or pool trades for this mint');
	const candles = candlesFromTrades(rows, intervalSeconds(interval)).filter((d) => d.t >= from && d.t <= to);
	if (!candles.length && !rows.some((r) => Number(r?.priceUsd) > 0)) throw new Error('no USD price for on-chain trades');
	return candles;
}

// ──────────────────────────────────────────────────────────────────────────────
// Cache — shared across both sources. Key includes interval + time window.
// ──────────────────────────────────────────────────────────────────────────────
const _cache = new Map(); // key → { value, source, expiresAt }
const TTL_MS = 30_000;

// Last good candles per mint+interval, kept well past the fresh-cache TTL so a
// GeckoTerminal rate-limit spell degrades the chart to slightly-old real data
// instead of a 502 and an empty panel. Never fabricated — only ever a payload
// an upstream really returned.
const _lastGood = new Map(); // `${mint}:${interval}` → { value, source, at }
const STALE_MAX_MS = 15 * 60_000;

function rememberGood(mint, interval, value, source) {
	_lastGood.set(`${mint}:${interval}`, { value, source, at: Date.now() });
	if (_lastGood.size > 256) _lastGood.delete(_lastGood.keys().next().value);
}

function recallGood(mint, interval) {
	const hit = _lastGood.get(`${mint}:${interval}`);
	if (!hit || Date.now() - hit.at > STALE_MAX_MS) return null;
	return hit;
}

// In-flight de-duplication, keyed the same as the fresh-data cache. A page
// mounting several chart widgets (or two tabs open on the same chart) can
// issue several near-simultaneous requests for the IDENTICAL mint+interval+
// window before the first one has resolved — each of those used to run its
// own independent Birdeye→Gecko→stale chain. Now every caller for the same
// key shares one resolution, which, combined with the concurrency gate and the
// shared ladder's retries and last-good copy, is what actually closes the
// poll-storm 502 rather than just shrinking its blast radius.
const _inflight = new Map(); // key → Promise<result descriptor>

// Runs the Birdeye → GeckoTerminal → on-chain trades → stale-cache chain once and returns a
// plain descriptor the caller turns into an HTTP response. Never throws —
// every failure mode is represented in the descriptor.
async function resolveCandles({ mint, interval, from, to, live, key, now }) {
	if (birdeyeConfigured()) {
		try {
			const data = await fetchBirdeyeOhlcv({ mint, interval, from, to });
			_cache.set(key, { value: data, source: 'birdeye', expiresAt: now + TTL_MS });
			if (_cache.size > 256) _cache.delete(_cache.keys().next().value);
			rememberGood(mint, interval, data, 'birdeye');
			return { kind: 'ok', data, source: 'birdeye' };
		} catch {
			// Fall through to GeckoTerminal.
		}
	}

	let geckoNoPool = false;
	try {
		const { data, source } = await fetchGeckoOhlcv({ mint, interval, from, to, live });
		_cache.set(key, { value: data, source, expiresAt: now + TTL_MS });
		if (_cache.size > 256) _cache.delete(_cache.keys().next().value);
		rememberGood(mint, interval, data, source);
		return { kind: 'ok', data, source };
	} catch (err) {
		geckoNoPool = err instanceof NoPoolError;
	}

	let chainNoMarket = false;
	try {
		const data = await fetchChainOhlcv({ mint, interval, from, to });
		_cache.set(key, { value: data, source: 'onchain', expiresAt: now + TTL_MS });
		if (_cache.size > 256) _cache.delete(_cache.keys().next().value);
		rememberGood(mint, interval, data, 'onchain');
		return { kind: 'ok', data, source: 'onchain' };
	} catch (err) {
		chainNoMarket = err instanceof NoPoolError;
	}

	// A token no source has a market for has nothing to chart: say so plainly.
	// This is a designed empty state, not an outage, so it is never served stale.
	if (geckoNoPool && chainNoMarket) return { kind: 'no_market' };

	const stale = recallGood(mint, interval);
	if (stale) return { kind: 'ok', data: stale.value, source: stale.source, stale: true, as_of: Math.floor(stale.at / 1000) };

	return { kind: 'error' };
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.publicIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const params = new URL(req.url, 'http://x').searchParams;
	const mint = (params.get('mint') || '').trim();
	if (!isPlausibleMint(mint)) {
		return error(res, 400, 'bad_mint', 'mint must be a base58 Solana address (32 to 44 chars)');
	}
	const interval = normalizeInterval(params.get('interval'));

	const nowSec = Math.floor(Date.now() / 1000);
	const rawTo = Math.min(nowSec, parseInt(params.get('to') || String(nowSec), 10) || nowSec);
	const defaultFrom = nowSec - 24 * 3600;
	let rawFrom = parseInt(params.get('from') || String(defaultFrom), 10);
	if (!Number.isFinite(rawFrom) || rawFrom <= 0 || rawFrom >= rawTo) rawFrom = defaultFrom;
	if (rawTo - rawFrom > 30 * 86400) rawFrom = rawTo - 30 * 86400;

	// Snap to the candle boundary so consecutive polls share one cache entry.
	const { from, to } = snapWindow({ interval, from: rawFrom, to: rawTo });
	// The window ends at the present (a polling chart), not at a past moment.
	const live = nowSec - to <= 2 * POLL_BUCKET_SECONDS;

	const key = `${mint}:${interval}:${from}:${to}`;
	const now = Date.now();
	const hit = _cache.get(key);
	if (hit && hit.expiresAt > now) {
		return json(
			res,
			200,
			{ data: hit.value, source: hit.source },
			{ 'cache-control': 'public, max-age=15, s-maxage=30' },
		);
	}

	// Share one resolution across every concurrent caller for this exact key.
	let pending = _inflight.get(key);
	if (!pending) {
		pending = resolveCandles({ mint, interval, from, to, live, key, now }).finally(() => _inflight.delete(key));
		_inflight.set(key, pending);
	}
	const result = await pending;

	if (result.kind === 'no_market') {
		return error(res, 404, 'no_market', 'No liquidity pool exists for this coin yet, so it has no price history.');
	}
	if (result.kind === 'error') {
		return error(res, 502, 'upstream_error', 'Price history is unavailable for this coin right now');
	}
	return json(
		res,
		200,
		result.stale
			? { data: result.data, source: result.source, stale: true, as_of: result.as_of }
			: { data: result.data, source: result.source },
		{ 'cache-control': result.stale ? 'public, max-age=10, s-maxage=10' : 'public, max-age=15, s-maxage=30' },
	);
});
