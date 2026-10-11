/**
 * Agent Sniper — historical strategy backtester.
 *
 *   POST /api/sniper/backtest  { agent_id, strategy, window_days?, network? }
 *     strategy.research (optional) applies Strategy Object research gates too.
 *     → honest projected metrics computed from REAL captured history
 *       (pump_coin_intel ⋈ pump_coin_outcomes), using the same entry gate and
 *       exit priority the live worker runs. Cached by strategy hash; the snapshot
 *       is linked to the agent so the trader profile can show projected-vs-realized.
 *
 * Read-only over real data — it never synthesizes launches or inflates win-rates.
 * If the captured window is too thin it returns an explicit "insufficient data"
 * verdict rather than a flattering number. That honesty is the product.
 *
 * Auth: session cookie OR bearer token, scoped to agents the caller owns.
 */

import { cors, json, method, readJson, wrap, error, rateLimited } from '../_lib/http.js';
import { getSessionUser, authenticateBearer, extractBearer } from '../_lib/auth.js';
import { requireCsrf } from '../_lib/csrf.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { sql } from '../_lib/db.js';
import { isUuid } from '../_lib/validate.js';
import { runBacktest, strategyHash, getCachedBacktest, saveBacktest, sanitizeResearch } from '../_lib/strategy-backtest.js';

const numOrNull = (v) => {
	if (v == null || v === '') return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
};
const intOrNull = (v) => {
	const n = numOrNull(v);
	return n == null ? null : Math.floor(n);
};
const lamportsStr = (v) => {
	if (v == null) return '0';
	const s = String(v).trim();
	if (/^\d+$/.test(s)) return s;
	const n = Number(s);
	return Number.isFinite(n) && n >= 0 ? String(Math.floor(n)) : '0';
};

// Pick + coerce only the fields the replay and the cache hash consume, so a
// hostile client can't smuggle anything unexpected into the read-only path.
function sanitizeStrategy(raw) {
	const s = raw && typeof raw === 'object' ? raw : {};
	return {
		trigger: s.trigger === 'intel_confirmed' || s.trigger === 'first_claim' ? s.trigger : 'new_mint',
		per_trade_lamports: lamportsStr(s.per_trade_lamports),
		slippage_bps: intOrNull(s.slippage_bps) ?? 500,
		max_price_impact_pct: numOrNull(s.max_price_impact_pct),
		min_market_cap_usd: numOrNull(s.min_market_cap_usd),
		max_market_cap_usd: numOrNull(s.max_market_cap_usd),
		min_creator_graduated: intOrNull(s.min_creator_graduated),
		max_creator_launches: intOrNull(s.max_creator_launches),
		require_socials: s.require_socials === true,
		require_sol_quote: s.require_sol_quote !== false,
		take_profit_pct: numOrNull(s.take_profit_pct),
		stop_loss_pct: numOrNull(s.stop_loss_pct),
		trailing_stop_pct: numOrNull(s.trailing_stop_pct),
		max_hold_seconds: intOrNull(s.max_hold_seconds),
		min_quality_score: numOrNull(s.min_quality_score),
		max_bundle_score: numOrNull(s.max_bundle_score),
		max_concentration_top1: numOrNull(s.max_concentration_top1),
		avoid_dev_dump: s.avoid_dev_dump !== false,
		allowed_categories: Array.isArray(s.allowed_categories)
			? s.allowed_categories.map((c) => String(c).toLowerCase()).filter(Boolean)
			: null,
		// Strategy Object v2 research gates (min holders, largest-holder cap,
		// liquidity, dev history, security), judged by the live evaluator.
		research: sanitizeResearch(s.research),
	};
}

async function resolveUser(req) {
	const session = await getSessionUser(req);
	if (session) return { id: session.id };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { id: bearer.userId };
	return null;
}

const ALLOWED_WINDOWS = new Set([7, 30, 90, 180]);

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await resolveUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in to backtest a strategy');

	const rl = await limits.sniperBacktestIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	if (!(await requireCsrf(req, res, user.id))) return;

	const body = await readJson(req);
	const agentId = String(body?.agent_id || '').trim();
	const network = body?.network === 'devnet' ? 'devnet' : 'mainnet';
	let windowDays = Math.floor(Number(body?.window_days));
	if (!ALLOWED_WINDOWS.has(windowDays)) windowDays = 30;

	if (!isUuid(agentId)) return error(res, 400, 'bad_request', 'agent_id must be a valid agent UUID');

	const [agent] = await sql`
		select id from agent_identities
		where id = ${agentId} and user_id = ${user.id} and deleted_at is null
		limit 1
	`;
	if (!agent) return error(res, 404, 'not_found', 'agent not found or not owned by you');

	const strategy = sanitizeStrategy(body?.strategy);
	const hash = strategyHash(strategy, windowDays, network);

	// Cache by strategy hash — the replay is deterministic over the same window.
	const cached = await getCachedBacktest(hash);
	if (cached) {
		// Keep the agent's projected-vs-realized link fresh even on a cache hit.
		await saveBacktest({ hash, agentId, userId: user.id, network, windowDays, result: cached }).catch(() => {});
		return json(res, 200, { ...cached, cached: true });
	}

	let result;
	try {
		result = await runBacktest(strategy, { windowDays, network });
	} catch (err) {
		return error(res, 502, 'backtest_failed', err?.message || 'Could not run the backtest — try again.');
	}

	result.ran_at = new Date().toISOString();
	await saveBacktest({ hash, agentId, userId: user.id, network, windowDays, result }).catch(() => {});

	return json(res, 200, { ...result, cached: false });
});
