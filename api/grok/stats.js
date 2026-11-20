// GET /api/grok/stats: live usage of the Grok MCP surface, read by /grok.
//
// Public and anonymous. Cached at the CDN for five minutes. Counts only: no
// user ids, client labels, prompts or model URLs (see api/_lib/grok-stats.js
// and tests/grok-stats.test.js). When the numbers cannot be read it answers
// 503 with no numbers, and /grok hides its Live section instead of showing
// zeros.

import { cors, error, json, method, wrap, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { buildGrokStats } from '../_lib/grok-stats.js';

export const STATS_CACHE = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600';

export default wrap(async (req, res) => {
	if (cors(req, res, { origins: '*', methods: 'GET,OPTIONS', payments: false })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.publicIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	let stats;
	try {
		stats = await buildGrokStats();
	} catch (err) {
		console.error('[grok-stats] aggregation failed:', err?.message);
		return error(res, 503, 'stats_unavailable', 'The Grok usage numbers could not be read right now. Try again in a minute.');
	}
	return json(res, 200, stats, { 'cache-control': STATS_CACHE });
});
