// GET /api/agents/:id/usage — owner-only usage stats for the LLM proxy.
// Returns current-month call count, quota, and a 30-day daily breakdown.

import { sql } from '../../_lib/db.js';
import { getSessionUser } from '../../_lib/auth.js';
import { cors, json, method, wrap, error } from '../../_lib/http.js';
import { readEmbedPolicy } from '../../_lib/embed-policy.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	const session = await getSessionUser(req);
	if (!session) return error(res, 401, 'unauthorized', 'sign in required');

	const url = new URL(req.url, 'http://x');
	const agentId = url.searchParams.get('id');
	if (!agentId) return error(res, 400, 'validation_error', 'id query param required');

	// Verify caller owns the agent
	const [agent] = await sql`
		SELECT id FROM agent_identities
		WHERE id = ${agentId} AND user_id = ${session.id} AND deleted_at IS NULL
	`;
	if (!agent) return error(res, 404, 'not_found', 'agent not found');

	// Read embed policy for the monthly quota value
	const policy = await readEmbedPolicy(agentId);
	const monthlyQuota = policy?.brain?.monthly_quota ?? null;

	// Current-month total
	const [monthRow] = await sql`
		SELECT COUNT(*)::int AS total
		FROM usage_events
		WHERE agent_id = ${agentId}
		  AND kind = 'llm'
		  AND created_at >= date_trunc('month', now())
	`;

	// 30-day daily breakdown
	const dailyRows = await sql`
		SELECT
			date_trunc('day', created_at)::date AS day,
			COUNT(*)::int AS calls
		FROM usage_events
		WHERE agent_id = ${agentId}
		  AND kind = 'llm'
		  AND created_at >= now() - interval '30 days'
		GROUP BY 1
		ORDER BY 1
	`;

	return json(res, 200, {
		agentId,
		monthlyQuota,
		currentMonthCalls: monthRow?.total ?? 0,
		dailyBreakdown: dailyRows.map((r) => ({ day: r.day, calls: r.calls })),
	});
});
