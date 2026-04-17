import { getSessionUser, sessionCookie } from '../../_lib/auth.js';
import { sql } from '../../_lib/db.js';
import { cors, json, error, method, wrap, readJson } from '../../_lib/http.js';

// POST /api/auth/session/revoke
// Body { sessionId: string } — revoke one session owned by the caller.
// Body { all: true }        — revoke every session (including current); clears cookie.
export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const body = await readJson(req);

	if (body.all === true) {
		const revoked = await sql`
			update sessions set revoked_at = now()
			where user_id = ${user.id} and revoked_at is null
			returning id
		`;
		res.setHeader('set-cookie', sessionCookie('', { clear: true }));
		return json(res, 200, { ok: true, revoked: revoked.length });
	}

	if (body.sessionId) {
		const revoked = await sql`
			update sessions set revoked_at = now()
			where id = ${body.sessionId} and user_id = ${user.id} and revoked_at is null
			returning id
		`;
		if (revoked.length === 0)
			return error(res, 404, 'not_found', 'session not found or already revoked');
		return json(res, 200, { ok: true, revoked: revoked.length });
	}

	return error(res, 400, 'validation_error', 'provide sessionId or all: true');
});
