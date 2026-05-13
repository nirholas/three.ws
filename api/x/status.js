// GET    /api/x/status      — current user's X connection + quota
// DELETE /api/x/status      — disconnect X account (soft delete: sets disconnected_at)

import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { cors, method, wrap, error, json } from '../_lib/http.js';

const FREE_MONTHLY_QUOTA = 5;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,DELETE,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'DELETE'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	if (req.method === 'DELETE') {
		await sql`
			update social_connections
			set disconnected_at = now(), updated_at = now()
			where user_id = ${user.id} and provider = 'x' and disconnected_at is null
		`;
		return json(res, 200, { disconnected: true });
	}

	const rows = await sql`
		select username, posts_this_month, month_resets_at, connected_at
		from social_connections
		where user_id = ${user.id} and provider = 'x' and disconnected_at is null
		limit 1
	`;
	const conn = rows[0];
	if (!conn) return json(res, 200, { connected: false });

	// Reset counter if month rolled over.
	let postsThisMonth = conn.posts_this_month;
	if (new Date(conn.month_resets_at) <= new Date()) {
		await sql`
			update social_connections
			set posts_this_month = 0,
			    month_resets_at = date_trunc('month', now()) + interval '1 month'
			where user_id = ${user.id} and provider = 'x'
		`;
		postsThisMonth = 0;
	}

	return json(res, 200, {
		connected: true,
		username: conn.username,
		posts_used: postsThisMonth,
		quota: FREE_MONTHLY_QUOTA,
		month_resets_at: conn.month_resets_at,
		connected_at: conn.connected_at,
	});
});
