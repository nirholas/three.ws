import { sql } from '../../_lib/db.js';
import { getSessionUser } from '../../_lib/auth.js';
import { cors, json, method, wrap, error } from '../../_lib/http.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'DELETE,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['DELETE'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthenticated', 'not signed in');

	const sessionId = req.query.id || req.url.split('/').pop();
	if (!UUID_REGEX.test(sessionId))
		return error(res, 400, 'invalid_id', 'session id must be a valid UUID');

	const rows = await sql`
		select id from sessions
		where id = ${sessionId} and user_id = ${user.id}
		limit 1
	`;

	if (!rows[0]) return error(res, 404, 'not_found', 'session not found');

	if (sessionId === user.sid)
		return error(res, 409, 'cannot_revoke_current', 'use POST /api/auth/logout to end the current session');

	await sql`update sessions set revoked_at = now() where id = ${sessionId}`;
	return json(res, 200, { revoked: 1 });
});
