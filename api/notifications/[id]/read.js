// POST /api/notifications/:id/read — mark a single notification as read.

import { sql } from '../../_lib/db.js';
import { getSessionUser } from '../../_lib/auth.js';
import { cors, json, method, wrap, error } from '../../_lib/http.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const id = req.query?.id;
	if (!id) return error(res, 400, 'validation_error', 'id required');

	const [row] = await sql`
		update user_notifications
		set read_at = coalesce(read_at, now())
		where id = ${id} and user_id = ${user.id}
		returning id, read_at
	`;

	if (!row) return error(res, 404, 'not_found', 'notification not found');

	return json(res, 200, { id: row.id, read_at: row.read_at });
});
