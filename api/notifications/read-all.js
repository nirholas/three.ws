// POST /api/notifications/read-all — mark all unread notifications as read.

import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { cors, json, method, wrap, error } from '../_lib/http.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const [{ count }] = await sql`
		update user_notifications
		set read_at = now()
		where user_id = ${user.id} and read_at is null
		returning count(*) over ()::int as count
	`;

	return json(res, 200, { marked_read: count ?? 0 });
});
