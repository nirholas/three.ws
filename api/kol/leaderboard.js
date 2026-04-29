// GET /api/kol/leaderboard?window=7d&limit=25
// → { items: [{ wallet, pnlUsd, winRate, trades, rank }] }
//
// Public read-only endpoint; no auth required. Rate-limited by IP.
// window ∈ '24h' | '7d' | '30d'   (default '7d')
// limit  ∈ 1..100                  (default 25, capped at 100)

import { cors, json, method, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { getLeaderboard } from '../../src/kol/leaderboard.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.mcpIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const url = new URL(req.url, `http://${req.headers.host}`);
	const window = url.searchParams.get('window') || '7d';
	const limitRaw = url.searchParams.get('limit');
	const limit = limitRaw != null ? Number(limitRaw) : 25;

	let items;
	try {
		items = await getLeaderboard({ window, limit });
	} catch (err) {
		if (err.status === 400) return error(res, 400, err.code || 'validation_error', err.message);
		throw err;
	}

	return json(res, 200, { items });
});
