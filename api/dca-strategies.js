// POST/GET/PATCH/DELETE /api/dca-strategies
// Compatibility facade for the delegation-signed EVM DCA schedules. They now
// live in the unified order store (api/_lib/dca-unified.js, rail 'evm'), run
// hourly by the run-dca cron in api/cron/[name].js; this endpoint keeps the
// request and response shapes /recurring and existing integrations were built
// on. The unified API covering both rails is /api/agents/:id/orders/dca.
//
//   POST                              create a strategy (delegation already signed)
//   GET    ?agent_id=<uuid>           list an agent's strategies
//   GET    /api/dca-strategies/<id>   one strategy plus its execution history
//   PATCH  /api/dca-strategies/<id>   pause or resume ({ "action": "pause" })
//   DELETE /api/dca-strategies/<id>   cancel (terminal; does NOT revoke the delegation)
//
// <id> is the strategy's order id; the dca_strategies id a schedule had before
// the merge is accepted too.

import { sql } from './_lib/db.js';
import { getSessionUser } from './_lib/auth.js';
import { cors, json, error, wrap, readJson, method, rateLimited } from './_lib/http.js';
import { requireCsrf } from './_lib/csrf.js';
import { requireRealFundsAgreement } from './_lib/real-funds-agreement.js';
import { isUuid } from './_lib/validate.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { planStatusChange } from './_lib/recurring.js';
import {
	listDca, findEvmDca, listEvmDcaExecutions, validateEvmDca, createEvmDca,
	pauseEvmDca, resumeEvmDca, cancelEvmDca, presentEvmDca, delegationBlocker,
} from './_lib/dca-unified.js';

// How many execution attempts a detail view returns.
const EXECUTION_HISTORY_LIMIT = 40;

/**
 * The strategy id from `/api/dca-strategies/<id>`, or from `?id=` when a
 * runtime rewrote the path into a query param.
 */
function strategyIdFrom(url) {
	const fromPath = url.pathname.split('/').pop();
	if (fromPath && fromPath !== 'dca-strategies') return fromPath;
	return url.searchParams.get('id');
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,PATCH,DELETE,OPTIONS', credentials: true })) return;

	const session = await getSessionUser(req);
	if (!session) return error(res, 401, 'unauthorized', 'sign in required');

	// State-changing methods on a cookie session require a CSRF token. These
	// strategies move real funds on a schedule, so a forged create/pause/cancel
	// is high-impact: gate every non-GET method.
	if (req.method !== 'GET' && !(await requireCsrf(req, res, session.id))) return;

	const url = new URL(req.url, 'http://x');

	// ── PATCH /api/dca-strategies/:id, pause / resume ────────────────────────
	if (req.method === 'PATCH') {
		const strategyId = strategyIdFrom(url);
		if (!strategyId) return error(res, 400, 'missing_param', 'strategy id required in path');
		if (!isUuid(strategyId)) return error(res, 400, 'validation_error', 'strategy id must be a uuid');

		const rl = await limits.authIp(clientIp(req));
		if (!rl.success) return rateLimited(res, rl);

		let body;
		try {
			body = await readJson(req);
		} catch (err) {
			return error(res, err.status || 400, 'validation_error', err.message);
		}
		if (body?.action !== 'pause' && body?.action !== 'resume') {
			return error(res, 400, 'validation_error', 'action must be "pause" or "resume"');
		}

		const found = await findEvmDca(session.id, strategyId);
		if (!found) return error(res, 404, 'not_found', 'strategy not found');

		const plan = planStatusChange(body.action, found.order.status);
		if (!plan.ok) {
			return error(res, plan.code === 'conflict' ? 409 : 400, plan.code, plan.message);
		}

		if (body.action === 'pause') {
			const paused = await pauseEvmDca(found.order.id);
			if (!paused) return error(res, 409, 'conflict', 'strategy changed while pausing');
			return json(res, 200, {
				ok: true,
				data: { id: paused.id, status: paused.status, paused_at: paused.paused_at, next_execution_at: paused.next_fire_at },
			});
		}

		if (!(await requireRealFundsAgreement(req, res, { userId: session.id, context: 'dca-resume' }))) return;
		const blocker = delegationBlocker(found);
		if (blocker) return error(res, 409, blocker.code, blocker.message);

		const resumed = await resumeEvmDca(found.order);
		if (!resumed) return error(res, 409, 'conflict', 'strategy changed while resuming');
		return json(res, 200, {
			ok: true,
			data: { id: resumed.id, status: resumed.status, next_execution_at: resumed.next_fire_at, resumed_at: resumed.resumed_at },
		});
	}

	// ── DELETE /api/dca-strategies/:id ─────────────────────────────────────────
	if (req.method === 'DELETE') {
		const strategyId = strategyIdFrom(url);
		if (!strategyId) return error(res, 400, 'missing_param', 'strategy id required in path');
		if (!isUuid(strategyId)) return error(res, 400, 'validation_error', 'strategy id must be a uuid');

		const rl = await limits.authIp(clientIp(req));
		if (!rl.success) return rateLimited(res, rl);

		// A paused strategy is cancellable too: cancel is the terminal state from
		// anywhere but itself.
		const found = await findEvmDca(session.id, strategyId);
		if (!found || found.order.status === 'cancelled') {
			return error(res, 404, 'not_found', 'strategy not found or already cancelled');
		}
		await cancelEvmDca(found.order.id);
		return json(res, 200, { ok: true });
	}

	// ── GET: one strategy with history, or an agent's list ───────────────────
	if (req.method === 'GET') {
		const rl = await limits.authedReadIp(clientIp(req));
		if (!rl.success) return rateLimited(res, rl);

		const detailId = strategyIdFrom(url);
		if (detailId) {
			if (!isUuid(detailId)) return error(res, 400, 'validation_error', 'strategy id must be a uuid');
			const found = await findEvmDca(session.id, detailId);
			if (!found) return error(res, 404, 'not_found', 'strategy not found');
			const executions = await listEvmDcaExecutions(found.order.id, { limit: EXECUTION_HISTORY_LIMIT });
			return json(res, 200, {
				ok: true,
				data: {
					...presentEvmDca(found.order),
					agent_name: found.agent_name,
					delegation_status: found.delegation_status,
					delegation_expires_at: found.delegation_expires_at,
					executions,
				},
			});
		}

		const agentId = url.searchParams.get('agent_id');
		if (!agentId) return error(res, 400, 'missing_param', 'agent_id is required');
		if (!isUuid(agentId)) return error(res, 400, 'validation_error', 'agent_id must be a uuid');

		const [agent] = await sql`
			SELECT id FROM agent_identities
			WHERE id = ${agentId} AND user_id = ${session.id} AND deleted_at IS NULL
			LIMIT 1
		`;
		if (!agent) return error(res, 404, 'not_found', 'agent not found');

		return json(res, 200, { ok: true, data: await listDca(agentId, { rail: 'evm' }) });
	}

	// ── POST /api/dca-strategies ───────────────────────────────────────────────
	if (!method(req, res, ['POST'])) return;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	let raw;
	try {
		raw = await readJson(req);
	} catch (err) {
		return error(res, err.status || 400, 'validation_error', err.message);
	}
	const v = validateEvmDca(raw);
	if (!v.ok) return error(res, v.status, v.code, v.message);

	const [agent] = await sql`
		SELECT id FROM agent_identities
		WHERE id = ${v.value.agent_id} AND user_id = ${session.id} AND deleted_at IS NULL
		LIMIT 1
	`;
	if (!agent) return error(res, 404, 'not_found', 'agent not found');
	if (!(await requireRealFundsAgreement(req, res, { userId: session.id, context: 'dca-create' }))) return;

	const created = await createEvmDca(session.id, v.value);
	if (!created.ok) return error(res, created.status, created.code, created.message);
	const o = created.order;
	return json(res, 201, { ok: true, id: o.id, status: o.status, next_execution_at: o.next_fire_at, created_at: o.created_at });
});
