// GET /api/admin/stats — aggregate platform metrics.

import { sql } from '../_lib/db.js';
import { cors, json, method, wrap } from '../_lib/http.js';
import { requireAdmin } from '../_lib/admin.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;
	if (!await requireAdmin(req, res)) return;

	const [counts] = await sql`
		select
			(select count(*) from users where deleted_at is null)::int                          as total_users,
			(select count(*) from users where deleted_at is null and created_at > now() - interval '7 days')::int as new_users_7d,
			(select count(*) from users where deleted_at is null and created_at > now() - interval '30 days')::int as new_users_30d,
			(select count(*) from avatars where deleted_at is null)::int                        as total_avatars,
			(select coalesce(sum(size_bytes),0) from avatars where deleted_at is null)::bigint  as total_bytes,
			(select count(*) from agent_identities where deleted_at is null)::int               as total_agents,
			(select count(*) from sessions where revoked_at is null and expires_at > now())::int as active_sessions,
			(select count(*) from users where plan='pro' and deleted_at is null)::int           as pro_users,
			(select count(*) from users where plan='team' and deleted_at is null)::int          as team_users,
			(select count(*) from users where plan='enterprise' and deleted_at is null)::int    as enterprise_users,
			(select count(*) from subscriptions where status='active')::int                     as active_subscriptions
	`;

	const recentSignups = await sql`
		select date_trunc('day', created_at)::date as day, count(*)::int as users
		from users
		where deleted_at is null and created_at > now() - interval '30 days'
		group by 1 order by 1
	`;

	const planBreakdown = await sql`
		select plan, count(*)::int as users
		from users where deleted_at is null
		group by plan order by users desc
	`;

	const chainBreakdown = await sql`
		select chain_type, count(*)::int as wallets
		from user_wallets
		group by chain_type order by wallets desc
	`;

	return json(res, 200, {
		counts,
		recentSignups,
		planBreakdown,
		chainBreakdown,
	});
});
