/**
 * Fade Radar, the inverse of the Smart Money Radar, as a public read API.
 *
 *   GET /api/pump/fade                          → live board: recent coins ranked
 *       &hours=6&limit=40&min_buyers=5            by how much proven-losing money
 *                                                 is in them
 *   GET /api/pump/fade?mint=<addr>              → one coin's fade read, with the
 *                                                 reverse-indicator wallets in it
 *                                                 (an unobserved coin resolves
 *                                                 200 + computed:false, matching
 *                                                 the intel / smart-money
 *                                                 convention, so detail pages
 *                                                 never 404)
 *   GET /api/pump/fade?wallets=1                → the reverse-indicator board
 *       &limit=25&min_judged=5&active_hours=24
 *   GET /api/pump/fade?calibration=1            → the measured, out-of-sample odds
 *                                                 behind the verdict bands
 *
 * A reverse indicator is a wallet observed buying at least five coins whose
 * outcome is now known, with zero winners among them. This endpoint never emits
 * a trade and never inverts a position: on a bonding curve the only tradeable
 * form of "fade" is not buying. Every number traces to observed on-chain buys
 * and recorded outcomes. Public and IP rate-limited.
 */

import { cors, json, method, error, wrap, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import {
	getFadeForMint,
	listFadeFeed,
	listReverseIndicators,
	getFadeCalibration,
	RI_MIN_JUDGED,
	MIN_BUYERS,
} from '../_lib/fade-radar.js';

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;
	const rl = await limits.mcpIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const url = new URL(req.url, 'http://x');
	const mint = url.searchParams.get('mint');

	if (mint) {
		const addr = mint.trim();
		if (!BASE58_RE.test(addr)) {
			return error(res, 400, 'invalid_mint', 'mint must be a base58 Solana address');
		}
		const coin = await getFadeForMint(addr);
		return json(res, 200, coin, { 'cache-control': 'public, max-age=15, stale-while-revalidate=30' });
	}

	if (url.searchParams.has('calibration')) {
		const calibration = await getFadeCalibration();
		return json(res, 200, calibration, {
			'cache-control': 'public, max-age=3600, stale-while-revalidate=21600',
		});
	}

	if (url.searchParams.has('wallets')) {
		const board = await listReverseIndicators({
			limit: clampInt(url.searchParams.get('limit'), 1, 100, 25),
			minJudged: clampInt(url.searchParams.get('min_judged'), RI_MIN_JUDGED, 500, RI_MIN_JUDGED),
			activeHours: clampInt(url.searchParams.get('active_hours'), 0, 24 * 90, 0),
		});
		return json(res, 200, board, { 'cache-control': 'public, max-age=60, stale-while-revalidate=120' });
	}

	const feed = await listFadeFeed({
		hours: clampInt(url.searchParams.get('hours'), 1, 72, 6),
		limit: clampInt(url.searchParams.get('limit'), 1, 100, 40),
		minBuyers: clampInt(url.searchParams.get('min_buyers'), 1, 50, MIN_BUYERS),
	});
	return json(res, 200, feed, { 'cache-control': 'public, max-age=20, stale-while-revalidate=60' });
});

// An absent query param is `null`, and `Number(null)` is 0, which is finite: a
// naive clamp turns "not supplied" into the floor rather than the default, so
// /api/pump/fade with no params answered for one hour instead of six and
// ?limit= unset would have returned a single row. Missing means default here.
function clampInt(v, lo, hi, def) {
	if (v == null || String(v).trim() === '') return def;
	const n = Math.floor(Number(v));
	if (!Number.isFinite(n)) return def;
	return Math.min(hi, Math.max(lo, n));
}
