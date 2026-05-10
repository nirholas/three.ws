/**
 * GET  /api/agent-strategy?id=<agent_id>  — fetch the strategy JSON stored on this agent.
 * POST /api/agent-strategy?id=<agent_id>  — replace it.  Body: { strategy: <any JSON> }
 *
 * The strategy is stored under agent_identities.meta.strategy. Owner-only.
 * For typed strategy execution (DCA, etc.) see api/cron/run-dca and the
 * dca_strategies table. This endpoint is the generic "freeform agent
 * configuration" slot.
 */
import { sql } from './_lib/db.js';
import { authenticateBearer, extractBearer, getSessionUser } from './_lib/auth.js';
import { cors, error, json, method, readJson, wrap } from './_lib/http.js';
import { clientIp, limits } from './_lib/rate-limit.js';

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { userId: bearer.userId };
	return null;
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,PUT,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST', 'PUT'])) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');

	const url = new URL(req.url, 'http://x');
	const agentId = url.searchParams.get('id');
	if (!agentId) return error(res, 400, 'validation_error', 'id query param required');

	const [agent] = await sql`
		SELECT id, user_id, meta FROM agent_identities
		WHERE id = ${agentId} AND deleted_at IS NULL
	`;
	if (!agent) return error(res, 404, 'not_found', 'agent not found');
	if (agent.user_id !== auth.userId) return error(res, 403, 'forbidden', 'not your agent');

	if (req.method === 'GET') {
		const rl = await limits.widgetRead(clientIp(req));
		if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

		const strategy = agent.meta?.strategy ?? null;
		if (strategy === null) return error(res, 404, 'not_found', 'no strategy set');
		return json(res, 200, { data: { strategy } });
	}

	// POST / PUT — replace
	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = await readJson(req).catch(() => null);
	if (!body || body.strategy === undefined) {
		return error(res, 400, 'validation_error', 'request body must include `strategy`');
	}

	const nextMeta = { ...(agent.meta || {}), strategy: body.strategy };
	await sql`
		UPDATE agent_identities SET meta = ${JSON.stringify(nextMeta)}::jsonb, updated_at = now()
		WHERE id = ${agentId}
	`;

	return json(res, 200, { data: { ok: true, strategy: body.strategy } });
});
