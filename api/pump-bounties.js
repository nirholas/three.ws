// GET /api/pump-bounties — read-only mirror of pump.fun GO's public bounty list.
//
// Proxies livestream-api.pump.fun/bounties/tasks (public, no auth) through a
// short server cache so we hit pump.fun rarely and serve every visitor from
// cache. Pagination is cursor-based (pass `cursor` = the previous page's
// `nextCursor`); `status` filters; `limit` caps at 50.
//
// pump.fun sits behind Cloudflare, which sometimes answers livestream-api
// requests with its own anti-bot challenge page (a 403 "Just a moment...",
// surfaced to us as a PumpGoError) with no server-side way to pass it. Before
// 2026-10-24 that left this route 502ing for every visitor for hours at a time
// (every 24h sample failed) even though the board had not actually changed.
// cacheWrapLastGood (api/_lib/cache.js) rides out the block the same way it
// already does for api/portal.js and the other pump.fun feeds: a fresh value
// is served for 30s, mirrored into a 24h last-known-good copy, and that copy
// answers (flagged with an x-pump-stale header) instead of a 502 when the
// live fetch throws.

import { cors, json, error, wrap, method, rateLimited } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { cacheWrapLastGood } from './_lib/cache.js';
import { listBounties, PumpGoError } from './_lib/pump-go.js';
import { clampInt } from './_lib/http-params.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	// Every (limit, cursor, status) triple is its own cache key, so an unthrottled
	// caller can walk the parameter space and miss the cache on every request,
	// turning this proxy into an open amplifier aimed at the upstream. Throttle per
	// IP first, on the same publicIp bucket the rest of the public read surface uses.
	const rl = await limits.publicIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const url = new URL(req.url, 'http://localhost');
	const limit = clampInt(url.searchParams.get('limit'), { max: 50, fallback: 30 });
	const cursor = url.searchParams.get('cursor') || null;
	const status = url.searchParams.get('status') || null;

	const cacheKey = `pumpgo:list:${limit}:${cursor || '_'}:${status || '_'}`;

	let value, stale;
	try {
		({ value, stale } = await cacheWrapLastGood(cacheKey, 30, () => listBounties({ limit, cursor, status }), { withMeta: true }));
	} catch (e) {
		if (!(e instanceof PumpGoError)) throw e;
		return error(res, e.status, e.code, e.message);
	}

	if (stale) res.setHeader('x-pump-stale', '1');
	res.setHeader('cache-control', 'public, s-maxage=30, stale-while-revalidate=120');
	return json(res, 200, value);
});
