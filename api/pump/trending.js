// GET /api/pump/trending?limit=25
// -------------------------------
// Trending Solana tokens for the dashboard chart picker and every other live
// market surface (home card, communities, constellation, visualizer).
//
// Primary source is Birdeye (keeps BIRDEYE_API_KEY server-side). When Birdeye is
// unconfigured, rate-limited, or down, we fall back to pump.fun's public frontend
// feed — same response shape — so the market surfaces degrade to live pump.fun
// data instead of a hard error. Only errors when both sources are unavailable.
//
// Response: { data: [ { mint, symbol, name, logo, price_usd, usd_market_cap, rank } ] }

import { cors, json, method, wrap, error, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { normalizeGatewayURL } from '../../src/ipfs.js';
import { getTrendingSlim } from '../_lib/pump-trending.js';
import { fetchPumpBoard } from '../_lib/pump-feed-fetch.js';

// Separate cache slot for the rich (full-coin) payload — it carries far more per
// token than the thin projection api/_lib/pump-trending.js caches, so it must
// not collide with that cache.
let _richCache = { value: null, storedAt: 0, expiresAt: 0, limit: 0 };
const TTL_MS = 30_000;
// How long a cached feed may be served as a stale fallback after every live
// upstream has failed. Bounds how old the market data can get during an outage.
const STALE_MAX_MS = 10 * 60_000;
// Upstream fetch timeout. Trending is a fast feed behind a 30s cache + stale
// fallback, so a long wait buys nothing — fail fast and fall through.
const UPSTREAM_TIMEOUT_MS = 5000;

// Serve a cached feed past its TTL when live upstreams are down. Returns the
// sliced value while it is within the stale window, else null. A slot holding
// fewer rows than asked still serves: the visualizer's 48-row request used to
// 502 while this instance held a perfectly good 24-row board, and a shorter
// list of real coins beats an outage envelope.
function serveStale(slot, limit, now) {
	if (!slot.value) return null;
	if (now - slot.storedAt > STALE_MAX_MS) return null;
	return slot.value.slice(0, limit);
}

// Rich variant: the full pump.fun coin objects (market cap, image, ATH, replies,
// age, socials, live flag) the 3D visualizer renders — sphere size, textures, and
// the detail panel all key off these fields, none of which survive the thin
// projection above. Images are repaired onto a working gateway, exactly like the
// other live-market surfaces. Birdeye is skipped here: it doesn't expose market
// cap, which is the whole point of the visualizer. Opt-in via `?rich=1` so the
// thin contract every other consumer relies on stays byte-for-byte unchanged.
function repairCoinImages(coins) {
	for (const c of coins) {
		if (!c || typeof c !== 'object') continue;
		if (c.image_uri) c.image_uri = normalizeGatewayURL(c.image_uri);
		if (c.image) c.image = normalizeGatewayURL(c.image);
	}
	return coins;
}

// Read through the shared pump.fun board reader (api/_lib/pump-feed-fetch.js)
// rather than a bare fetch. pump.fun sits behind Cloudflare, which answers a
// burst from the shared Cloud Run egress with a fast 429; the bare fetch here
// had no retry, no identified user-agent and only this instance's memory to
// fall back on, so a cold instance turned every rate-limit blip into a 502
// within ~100ms. The shared reader retries once honouring Retry-After and
// keeps a cross-instance last-known-good board for 30 minutes.
//
// Returns { data, stale } or null when the board failed with nothing to serve.
async function fetchPumpFunRich(limit) {
	const board = await fetchPumpBoard({ limit, timeoutMs: UPSTREAM_TIMEOUT_MS });
	if (!board?.rows?.length) return null;
	// The board rows are shared with other readers through the cache, so repair
	// images on copies rather than mutating rows another caller may hold.
	const data = repairCoinImages(board.rows.map((c) => ({ ...c })));
	return { data, stale: board.stale };
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	// Dedicated lobby bucket — NOT the shared publicIp pool. This feed renders the
	// /play lobby on page load; sharing a 60/min bucket with ~166 other public
	// endpoints meant any busy three.ws session 429'd its own lobby (2026-07-09).
	const rl = await limits.marketFeedIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const params = new URL(req.url, 'http://x').searchParams;
	const raw = Number(params.get('limit') || '25');
	const limit = Math.min(50, Math.max(1, Number.isFinite(raw) ? Math.floor(raw) : 25));
	const rich = params.get('rich') === '1' || params.get('rich') === 'true';

	const now = Date.now();

	if (rich) {
		if (_richCache.value && _richCache.limit >= limit && _richCache.expiresAt > now) {
			return json(res, 200, { data: _richCache.value.slice(0, limit) }, {
				'cache-control': 'public, max-age=15, s-maxage=30',
			});
		}
		const board = await fetchPumpFunRich(limit);
		if (board?.stale) {
			// Live board failed but the shared last-known-good copy answered. Say
			// so, and keep the edge cache short so the live source is retried soon.
			return json(res, 200, { data: board.data.slice(0, limit), stale: true }, {
				'cache-control': 'public, max-age=10, s-maxage=20',
			});
		}
		if (!board) {
			// Upstream down — serve the last good payload as stale rather than blanking
			// the visualizer. Shorter edge cache so we retry the live source soon.
			const stale = serveStale(_richCache, limit, now);
			if (stale) {
				return json(res, 200, { data: stale, stale: true }, {
					'cache-control': 'public, max-age=10, s-maxage=20',
				});
			}
			console.warn('[pump/trending] rich board unavailable (pump.fun live + last-known-good) and no stale cache');
			return error(res, 502, 'upstream_error', 'Trending market data is temporarily unavailable');
		}
		_richCache = { value: board.data, storedAt: now, expiresAt: now + TTL_MS, limit };
		return json(res, 200, { data: board.data.slice(0, limit) }, { 'cache-control': 'public, max-age=15, s-maxage=30' });
	}

	// Thin projection: fetch+cache+fallback lives in api/_lib/pump-trending.js,
	// shared with the free GET /api/v1/pump/trending endpoint.
	const { data, stale } = await getTrendingSlim(limit);
	if (!data) {
		// Both live sources are down and no usable stale cache exists — the home
		// card, communities, constellation, and visualizer would otherwise dead-end
		// on a 502 during the blip; getTrendingSlim already tried the stale fallback.
		return error(res, 502, 'upstream_error', 'Trending market data is temporarily unavailable');
	}
	if (stale) {
		return json(res, 200, { data, stale: true }, { 'cache-control': 'public, max-age=10, s-maxage=20' });
	}
	return json(res, 200, { data }, { 'cache-control': 'public, max-age=15, s-maxage=30' });
});
