// GET   /api/admin/user/:id  — full user detail
// PATCH /api/admin/user/:id  — update plan, is_admin, or soft-delete

import { z } from 'zod';
import { sql } from '../../_lib/db.js';
import { cors, json, method, readJson, wrap, error } from '../../_lib/http.js';
import { requireAdmin } from '../../_lib/admin.js';
import { parse } from '../../_lib/validate.js';

const patchSchema = z.object({
	plan:     z.enum(['free','pro','team','enterprise']).optional(),
	is_admin: z.boolean().optional(),
	deleted:  z.boolean().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'nothing to update' });

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,PATCH,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'PATCH'])) return;
	if (!await requireAdmin(req, res)) return;

	const id = req.url.split('/').pop().split('?')[0];
	if (!id) return error(res, 400, 'bad_request', 'missing user id');

	if (req.method === 'GET') {
		const [user] = await sql`
			select
				u.id, u.email, u.display_name, u.plan, u.is_admin,
				u.wallet_address, u.email_verified, u.created_at, u.updated_at, u.deleted_at,
				(
					select json_agg(json_build_object(
						'address', w.address, 'chain_type', w.chain_type,
						'is_primary', w.is_primary, 'created_at', w.created_at
					) order by w.created_at)
					from user_wallets w where w.user_id = u.id
				) as wallets,
				(select count(*)::int from avatars a where a.owner_id = u.id and a.deleted_at is null) as avatar_count,
				(select count(*)::int from agent_identities ai where ai.user_id = u.id and ai.deleted_at is null) as agent_count,
				(select count(*)::int from sessions s where s.user_id = u.id and s.revoked_at is null and s.expires_at > now()) as active_sessions,
				(select json_agg(json_build_object('plan', sub.plan, 'chain_type', sub.chain_type, 'status', sub.status, 'active_until', sub.active_until) order by sub.created_at desc)
					from subscriptions sub where sub.user_id = u.id) as subscriptions
			from users u
			where u.id = ${id}
			limit 1
		`;
		if (!user) return error(res, 404, 'not_found', 'user not found');
		return json(res, 200, { user });
	}

	// PATCH
	const body = parse(patchSchema, await readJson(req));
	const sets = [];
	if (body.plan     !== undefined) sets.push(sql`plan = ${body.plan}`);
	if (body.is_admin !== undefined) sets.push(sql`is_admin = ${body.is_admin}`);
	if (body.deleted  !== undefined) sets.push(sql`deleted_at = ${body.deleted ? sql`now()` : null}`);

	const [updated] = await sql`
		update users set ${sql(sets.reduce((a, b) => sql`${a}, ${b}`))}
		where id = ${id}
		returning id, email, display_name, plan, is_admin, deleted_at
	`;
	if (!updated) return error(res, 404, 'not_found', 'user not found');
	return json(res, 200, { user: updated });
});
