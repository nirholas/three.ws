// GET /api/usage/summary — per-user usage numbers for the dashboard.

import { sql } from '../_lib/db.js';
import { getSessionUser, authenticateBearer, extractBearer, hasScope } from '../_lib/auth.js';
import { cors, json, method, wrap, error } from '../_lib/http.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	let userId = null;
	const session = await getSessionUser(req);
	if (session) userId = session.id;
	else {
		const bearer = await authenticateBearer(extractBearer(req));
		if (bearer && hasScope(bearer.scope, 'profile')) userId = bearer.userId;
	}
	if (!userId) return error(res, 401, 'unauthorized', 'authentication required');

	const [row] = await sql`
		select
			q.*,
			(select count(*) from avatars where owner_id = ${userId} and deleted_at is null) as avatars,
			(select coalesce(sum(size_bytes),0) from avatars where owner_id = ${userId} and deleted_at is null) as bytes,
			(select count(*) from usage_events where user_id = ${userId} and created_at > now() - interval '24 hours' and kind = 'tool_call') as mcp_calls_24h,
			(select count(*) from usage_events where user_id = ${userId} and created_at > now() - interval '30 days') as events_30d
		from users u
		join plan_quotas q on q.plan = u.plan
		where u.id = ${userId}
	`;
	if (!row) return error(res, 500, 'internal', 'plan quota record missing for user');
	const { avatars, bytes, mcp_calls_24h, events_30d, ...plan } = row;
	return json(res, 200, {
		plan,
		counts: {
			avatars: Number(avatars),
			bytes: Number(bytes),
			mcp_calls_24h: Number(mcp_calls_24h),
			events_30d: Number(events_30d),
		},
	});
});
