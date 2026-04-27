// GET  /api/admin/users?q=&plan=&page=&limit=
// Returns paginated user list with wallet summary.

import { sql } from '../_lib/db.js';
import { cors, json, method, wrap } from '../_lib/http.js';
import { requireAdmin } from '../_lib/admin.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;
	if (!await requireAdmin(req, res)) return;

	const params = new URL(req.url, 'http://x').searchParams;
	const q      = (params.get('q') || '').trim().slice(0, 200);
	const plan   = params.get('plan') || null;
	const page   = Math.max(1, parseInt(params.get('page') || '1', 10));
	const limit  = Math.min(100, Math.max(1, parseInt(params.get('limit') || '50', 10)));
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
});
