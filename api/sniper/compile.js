/**
 * Agent Sniper — natural-language strategy compiler.
 *
 *   POST /api/sniper/compile  { agent_id, text, network? }
 *     → { ok, via, strategy, summary, strategy_object, explanations, assumptions, clamped, warnings }
 *
 * `strategy_object` is the same intent as a version 2 Strategy Object config
 * (research gates, price-impact cap, ask/auto mode) and `explanations` says, per
 * field, where each value came from; the /strategies builder fills from it.
 *
 * Turns a plain-English description ("snipe creators who've graduated at least
 * two, market cap under $30k, organic distribution, take profit at 3x, stop loss
 * 40%, max 0.3 SOL per trade") into a validated strategy shaped exactly like the
 * api/sniper/strategy.js arm body. Every money/risk knob is clamped to the
 * agent's runtime trade guards (agent-trade-guards.js) so a compiled strategy can
 * never bypass a spend cap or the price-impact breaker; the LLM runs through the
 * platform's free-first proxy (api/_lib/llm.js) — no browser-side provider keys.
 *
 * Auth: session cookie OR bearer token, scoped to agents the caller owns.
 */

import { cors, json, method, readJson, wrap, error, rateLimited } from '../_lib/http.js';
import { getSessionUser, authenticateBearer, extractBearer } from '../_lib/auth.js';
import { requireCsrf } from '../_lib/csrf.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { sql } from '../_lib/db.js';
import { isUuid } from '../_lib/validate.js';
import { getTradeLimits } from '../_lib/agent-trade-guards.js';
import { compileStrategyFromText } from '../_lib/strategy-compiler.js';

async function resolveUser(req) {
	const session = await getSessionUser(req);
	if (session) return { id: session.id, bearer: false };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { id: bearer.userId, bearer: true };
	return null;
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await resolveUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in to compile a strategy');

	const rl = await limits.sniperCompileIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	if (!(await requireCsrf(req, res, user.id))) return;

	const body = await readJson(req);
	const agentId = String(body?.agent_id || '').trim();
	const network = body?.network === 'devnet' ? 'devnet' : 'mainnet';
	const text = typeof body?.text === 'string' ? body.text : '';

	if (!isUuid(agentId)) return error(res, 400, 'bad_request', 'agent_id must be a valid agent UUID');
	if (text.trim().length < 3) return error(res, 400, 'bad_request', 'Describe your strategy in a sentence or two first.');

	// Ownership — and the agent's runtime trade guards to clamp against.
	const [agent] = await sql`
		select id, meta from agent_identities
		where id = ${agentId} and user_id = ${user.id} and deleted_at is null
		limit 1
	`;
	if (!agent) return error(res, 404, 'not_found', 'agent not found or not owned by you');

	const tradeLimits = getTradeLimits(agent.meta);

	let result;
	try {
		result = await compileStrategyFromText(text, {
			tradeLimits,
			network,
			track: { userId: user.id, agentId },
		});
	} catch (err) {
		// LLM/data failure — surface a clean, retryable boundary error.
		return error(res, 502, 'compile_failed', err?.message || 'Could not compile the strategy — try again.');
	}

	if (!result.ok) return error(res, 400, result.error || 'compile_failed', result.message || 'Could not compile the strategy.');

	return json(res, 200, result);
});
