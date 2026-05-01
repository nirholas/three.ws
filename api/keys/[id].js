// DELETE /api/keys/:id — revoke an API key

import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { logAudit } from '../_lib/audit.js';
import { cors, json, method, wrap, error } from '../_lib/http.js';
import { limits } from '../_lib/rate-limit.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'DELETE,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['DELETE'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in to manage API keys');

	const rl = await limits.apiKeyManage(user.id);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const id = req.query?.id || new URL(req.url, 'http://x').pathname.split('/').pop();
	const rows = await sql`
		update api_keys set revoked_at = now()
		where id = ${id} and user_id = ${user.id} and revoked_at is null
		returning id
	`;
	if (!rows[0]) return error(res, 404, 'not_found', 'key not found or already revoked');
	logAudit({
		userId: user.id,
		action: 'revoke_api_key',
		resourceId: rows[0].id,
		meta: { via: 'session' },
	});
	return json(res, 200, { ok: true });
});
