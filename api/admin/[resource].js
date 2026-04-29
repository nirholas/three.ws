import { sql } from '../_lib/db.js';
import { cors, json, method, wrap } from '../_lib/http.js';
import { requireAdmin } from '../_lib/admin.js';

export default wrap(async (req, res) => {
	const resource = req.query?.resource;

	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;
	if (!(await requireAdmin(req, res))) return;

	if (resource === 'stats') {
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

		return json(res, 200, { counts, recentSignups, planBreakdown, chainBreakdown });
	}

	if (resource === 'users') {
		const params = new URL(req.url, 'http://x').searchParams;
		const q = (params.get('q') || '').trim().slice(0, 200);
		const plan = params.get('plan') || null;
		const page = Math.max(1, parseInt(params.get('page') || '1', 10));
		const limit = Math.min(100, Math.max(1, parseInt(params.get('limit') || '50', 10)));
		const offset = (page - 1) * limit;

		const users = await sql`
			select
				u.id, u.email, u.display_name, u.plan, u.is_admin,
				u.wallet_address, u.created_at, u.deleted_at,
				(
					select json_agg(json_build_object('address', w.address, 'chain_type', w.chain_type, 'is_primary', w.is_primary))
					from user_wallets w where w.user_id = u.id
				) as wallets,
				(select count(*)::int from avatars a where a.owner_id = u.id and a.deleted_at is null) as avatar_count
			from users u
			where
				u.deleted_at is null
				and (${q} = '' or u.email ilike ${'%' + q + '%'} or u.display_name ilike ${'%' + q + '%'} or u.wallet_address ilike ${'%' + q + '%'})
				and (${plan} is null or u.plan = ${plan})
			order by u.created_at desc
			limit ${limit} offset ${offset}
		`;

		const [{ total }] = await sql`
			select count(*)::int as total from users u
			where
				u.deleted_at is null
				and (${q} = '' or u.email ilike ${'%' + q + '%'} or u.display_name ilike ${'%' + q + '%'} or u.wallet_address ilike ${'%' + q + '%'})
				and (${plan} is null or u.plan = ${plan})
		`;

		return json(res, 200, { users, total, page, limit });
	}

	res.statusCode = 404;
	return res.end();
});
