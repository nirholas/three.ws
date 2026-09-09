/**
 * Rivalries: who just took whose place on the trader board, and why.
 *
 *   GET /api/sniper/rivalries?network=mainnet&window=7d&lookback=24h&limit=6
 *
 * Pairs every trader on the live board with the one directly above them and
 * says what changed since the lookback cutoff: an overtake, a debut, or a
 * standing gap, each with the P&L both sides booked inside the lookback. Derived
 * entirely from `agent_sniper_positions` / `agent_strategy_positions` through the
 * shared trader-stats truth layer, so a matchup can never disagree with the
 * leaderboard or with either trader's profile.
 *
 * Public + IP rate-limited. The on-chain signatures behind every number are
 * public, so the argument about them should be too.
 */

import { cors, json, method, wrap, error, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { WINDOWS } from '../_lib/trader-stats.js';
import { getRivalries, LOOKBACKS } from '../_lib/rivalries.js';

const NETWORKS = new Set(['mainnet', 'devnet']);
const MAX_LIMIT = 12;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.publicIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const params = new URL(req.url, `http://${req.headers.host || 'x'}`).searchParams;

	const rawNetwork = params.get('network');
	if (rawNetwork && !NETWORKS.has(rawNetwork)) {
		return error(res, 400, 'invalid_network', 'network must be mainnet or devnet');
	}
	const rawWindow = params.get('window');
	if (rawWindow && !WINDOWS.has(rawWindow)) {
		return error(res, 400, 'invalid_window', `window must be one of ${[...WINDOWS].join(', ')}`);
	}
	const rawLookback = params.get('lookback');
	if (rawLookback && !LOOKBACKS.has(rawLookback)) {
		return error(res, 400, 'invalid_lookback', `lookback must be one of ${[...LOOKBACKS.keys()].join(', ')}`);
	}
	const rawLimit = params.get('limit');
	let limit = 6;
	if (rawLimit != null && rawLimit !== '') {
		const n = Number(rawLimit);
		if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
			return error(res, 400, 'invalid_limit', `limit must be an integer between 1 and ${MAX_LIMIT}`);
		}
		limit = n;
	}

	const out = await getRivalries({
		network: rawNetwork || 'mainnet',
		window: rawWindow || '7d',
		lookback: rawLookback || '24h',
		limit,
	});

	return json(res, 200, out, { 'cache-control': 'public, max-age=30, s-maxage=60' });
});
