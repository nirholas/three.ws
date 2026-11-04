/**
 * Oracle — wallet intelligence.
 *
 *   GET /api/oracle/wallet?address=<wallet>&network=mainnet   → one wallet's profile
 *   GET /api/oracle/wallet?leaderboard=1&label=smart_money    → reputation leaderboard
 *
 * The leaderboard ranks every wallet the brain has judged by smart-money score;
 * the profile returns a wallet's archetype, track record, and recent coins. This
 * is the "classify the actual traders" surface — across the whole order book, not
 * just one coin.
 */

import { cors, json, method, wrap, error, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { readLeaderboard, readWallet } from '../_lib/oracle/store.js';
import { isDbUnavailableError } from '../_lib/db.js';
import { archetypeFor } from '../_lib/oracle/archetype.js';

const NETWORKS = new Set(['mainnet', 'devnet']);
const LABELS = new Set(['smart_money', 'sniper', 'dumper', 'rugger', 'fresh', 'neutral', 'unproven']);
const WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.mcpIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const url = new URL(req.url, `http://${req.headers.host || 'x'}`);
	const p = url.searchParams;
	const network = NETWORKS.has(p.get('network')) ? p.get('network') : 'mainnet';

	// Leaderboard mode.
	if (p.get('leaderboard') === '1' || p.get('leaderboard') === 'true') {
		const label = LABELS.has(p.get('label')) ? p.get('label') : null;
		const limit = Math.min(200, Math.max(1, Number(p.get('limit')) || 50));
		const rows = await readLeaderboard({ network, limit, label });
		const items = rows.map((r) => ({ ...r, archetype: archetypeFor(r.label) }));
		return json(res, 200, { network, count: items.length, items }, {
			'Cache-Control': 'public, max-age=10, stale-while-revalidate=60',
		});
	}

	// Single-wallet profile mode.
	const address = (p.get('address') || '').trim();
	if (!WALLET_RE.test(address)) return error(res, 400, 'validation_error', 'a valid wallet address or leaderboard=1 is required');

	// A connectivity failure is not "this wallet has no record": answering it as an
	// unproven profile told callers a known smart-money wallet was a stranger.
	// Rethrow so wrap() answers 503 + Retry-After; a statement fault keeps the
	// documented unproven answer.
	const { rep, recent } = await readWallet(address, network).catch((err) => {
		if (isDbUnavailableError(err)) throw err;
		return { rep: null, recent: [] };
	});
	if (!rep) {
		// Unknown wallet — still return a well-formed unproven profile.
		return json(res, 200, {
			network, address, known: false,
			archetype: archetypeFor(null),
			reputation: null,
			recent: [],
		});
	}

	return json(res, 200, {
		network, address, known: true,
		archetype: archetypeFor(rep.label),
		reputation: {
			label: rep.label,
			score: Number(rep.smart_money_score || 0),
			win_rate: Number(rep.win_rate || 0),
			early_win_rate: Number(rep.early_win_rate || 0),
			dump_rate: Number(rep.dump_rate || 0),
			coins_traded: rep.coins_traded,
			early_entries: rep.early_entries,
			wins: rep.wins,
			early_wins: rep.early_wins,
			duds: rep.duds,
			dumps: rep.dumps,
			creator_count: rep.creator_count,
			creator_wins: rep.creator_wins,
			first_seen_at: rep.first_seen_at,
			last_active_at: rep.last_active_at,
		},
		recent: recent.map((c) => ({
			mint: c.mint, symbol: c.symbol, name: c.name, image_uri: c.image_uri, category: c.category,
			buy_sol: Number(c.buy_lamports || 0) / 1e9,
			sell_sol: Number(c.sell_lamports || 0) / 1e9,
			is_creator: c.is_creator, last_seen_at: c.last_seen_at,
		})),
	}, { 'Cache-Control': 'public, max-age=10, stale-while-revalidate=60' });
});
