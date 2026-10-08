// GET /api/leaderboard/earnings[?window=24h|7d|30d|all&limit=&offset=]: public
// agents ranked by what they earned in a window. Earnings are pump.fun creator
// fees on the coins an agent launched plus its service income (x402 skill sales
// and completed hires), each shown separately with the total in SOL and USD.
//
// The ranking and every row's figures come from listEarningsLeaderboard in
// api/_lib/agent-earnings.js, the same computation behind
// GET /api/agents/:id/earnings, so a row and the agent's own Earned card always
// agree. Rows carry their rank in the previous window of the same length
// (`previous_rank`, `movement`), except for 'all'.
//
// Figures come from the creator-earnings snapshot the cron refreshes every 30
// minutes, so the response is cached for a minute at the edge.

import { cors, json, method, wrap, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { listEarningsLeaderboard, normalizeWindow } from '../_lib/agent-earnings.js';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

/** @param {string | null} v @param {number} fallback @param {number} max */
function intParam(v, fallback, max) {
	const n = Number.parseInt(String(v ?? ''), 10);
	if (!Number.isFinite(n) || n < 0) return fallback;
	return Math.min(n, max);
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.mcpIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const url = new URL(req.url, 'http://x');
	const window = normalizeWindow(url.searchParams.get('window') || '7d');
	const limit = Math.max(1, intParam(url.searchParams.get('limit'), DEFAULT_LIMIT, MAX_LIMIT));
	const offset = intParam(url.searchParams.get('offset'), 0, 100_000);

	const body = await listEarningsLeaderboard({ window, limit, offset });
	res.setHeader('cache-control', 'public, max-age=60, s-maxage=120, stale-while-revalidate=300');
	return json(res, 200, body);
});
