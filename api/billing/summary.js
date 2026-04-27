// GET /api/billing/summary — current user's plan, quotas, and usage roll-ups.
// Powers the dashboard "Plan & usage" tab. Owner-only; session auth.

import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { cors, json, method, wrap, error } from '../_lib/http.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const [quotaRow] = await sql`
		select q.plan, q.max_avatars, q.max_bytes_per_avatar, q.max_total_bytes, q.mcp_calls_per_day
		from users u join plan_quotas q on q.plan = u.plan
		where u.id = ${user.id}
		limit 1
	`;

	const [avatarUsage] = await sql`
		select coalesce(count(*), 0)::int as avatar_count,
		       coalesce(sum(size_bytes), 0)::bigint as total_bytes
		from avatars
		where owner_id = ${user.id} and deleted_at is null
	`;

	const [agentRow] = await sql`
		select coalesce(count(*), 0)::int as agent_count
		from agent_identities
		where user_id = ${user.id} and deleted_at is null
	`;

	const [mcpRow] = await sql`
		select coalesce(count(*), 0)::int as calls_24h
		from usage_events
		where user_id = ${user.id}
		  and kind = 'tool_call'
		  and created_at >= now() - interval '24 hours'
	`;

	const [llmRow] = await sql`
		select coalesce(count(*), 0)::int as calls_month
		from usage_events
		where user_id = ${user.id}
		  and kind = 'llm'
		  and created_at >= date_trunc('month', now())
	`;

	const plan = quotaRow?.plan ?? user.plan ?? 'free';

	return json(res, 200, {
		plan,
		quotas: quotaRow
			? {
					max_avatars: quotaRow.max_avatars,
					max_bytes_per_avatar: Number(quotaRow.max_bytes_per_avatar),
					max_total_bytes: Number(quotaRow.max_total_bytes),
					mcp_calls_per_day: quotaRow.mcp_calls_per_day,
				}
			: null,
		usage: {
			avatar_count: avatarUsage?.avatar_count ?? 0,
			total_bytes: Number(avatarUsage?.total_bytes ?? 0),
			agent_count: agentRow?.agent_count ?? 0,
			mcp_calls_24h: mcpRow?.calls_24h ?? 0,
			llm_calls_month: llmRow?.calls_month ?? 0,
		},
	});
});
