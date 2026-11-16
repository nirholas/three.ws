// GET /api/nvidia/stats: live status and measured latency for every NVIDIA
// lane, read by /nvidia and /nvidia/benchmarks.
//
//   ?format=csv   the same numbers as a CSV download
//
// Public and anonymous. Cached at the CDN for five minutes. The payload carries
// lane ids, model ids, statuses, counts, percentiles, GPU names and regions
// only: no user ids, prompts, keys or internal hostnames (see
// api/_lib/nvidia-lanes.js buildNvidiaStats and tests/nvidia-stats.test.js).

import { cors, error, json, method, wrap, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { buildNvidiaStats, statsToCsv } from '../_lib/nvidia-lanes.js';

export const STATS_CACHE = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600';

export default wrap(async (req, res) => {
	if (cors(req, res, { origins: '*', methods: 'GET,OPTIONS', payments: false })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.publicIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	let stats;
	try {
		stats = await buildNvidiaStats();
	} catch (err) {
		console.error('[nvidia-stats] aggregation failed:', err?.message);
		return error(res, 503, 'stats_unavailable', 'The lane statistics could not be read right now. Try again in a minute.');
	}

	const url = new URL(req.url, 'http://localhost');
	if (url.searchParams.get('format') === 'csv') {
		res.statusCode = 200;
		res.setHeader('content-type', 'text/csv; charset=utf-8');
		res.setHeader('content-disposition', `attachment; filename="three-ws-nvidia-lanes-${stats.generated_at.slice(0, 10)}.csv"`);
		res.setHeader('cache-control', STATS_CACHE);
		res.end(statsToCsv(stats));
		return;
	}
	return json(res, 200, stats, { 'cache-control': STATS_CACHE });
});
