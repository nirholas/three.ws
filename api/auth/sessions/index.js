import { sql } from '../../_lib/db.js';
import { getSessionUser } from '../../_lib/auth.js';
import { cors, json, method, wrap, error } from '../../_lib/http.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,DELETE,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'DELETE'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthenticated', 'not signed in');

	if (req.method === 'GET') {
		const currentSessionId = user.sid;
		const rows = await sql`
			select id, user_agent, ip, created_at, last_seen_at
			from sessions
			where user_id = ${user.id} and revoked_at is null
			order by last_seen_at desc
		`;
		const sessions = rows.map((s) => ({
			...s,
			current: s.id === currentSessionId,
		}));
		return json(res, 200, { sessions });
	}

	if (req.method === 'DELETE') {
		const currentSessionId = user.sid;
		const result = await sql`
			update sessions
			set revoked_at = now()
			where user_id = ${user.id} and revoked_at is null and id != ${currentSessionId}
		`;
		return json(res, 200, { revoked: result.count });
	}
});
