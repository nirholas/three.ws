// DELETE /api/keys/:id — revoke an API key

import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { cors, json, method, wrap, error } from '../_lib/http.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'DELETE,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['DELETE'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in to manage API keys');

	const id = req.query?.id || new URL(req.url, 'http://x').pathname.split('/').pop();
	const rows = await sql`
		update api_keys set revoked_at = now()
		where id = ${id} and user_id = ${user.id} and revoked_at is null
		returning id
	`;
	if (!rows[0]) return error(res, 404, 'not_found', 'key not found or already revoked');
	return json(res, 200, { ok: true });
});
