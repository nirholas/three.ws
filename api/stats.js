/**
 * Public platform totals.
 *
 * GET /api/stats
 *
 * Real aggregates (agents, launches, volume, earnings paid, active strategies),
 * each with its source table and read time. A figure that cannot be read is
 * reported `available: false`, never zero. Cached 60s at the edge and in
 * process. For marketing-strip numbers see /api/home-stats; this is the
 * citable, machine-readable version.
 */

import { cors, json, method, wrap, rateLimited } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { cacheWrap } from './_lib/cache.js';
import { gatherPlatformStats } from './_lib/platform-stats.js';

const TTL_SECONDS = 60;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.publicIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const stats = await cacheWrap('platform:stats:v1', TTL_SECONDS, gatherPlatformStats);
	return json(res, 200, { stats, cache_ttl_seconds: TTL_SECONDS }, {
		'cache-control': `public, s-maxage=${TTL_SECONDS}, stale-while-revalidate=${TTL_SECONDS * 5}`,
	});
});
