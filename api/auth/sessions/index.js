import { sql } from '../../_lib/db.js';
import { getSessionUser, rotateSession, sessionCookie } from '../../_lib/auth.js';
import { cors, json, method, wrap, error } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,DELETE,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'DELETE'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthenticated', 'not signed in');

	const ip = clientIp(req);
	const rl = await limits.authIp(ip);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	if (req.method === 'GET') {
		const rows = await sql`
			select id, user_agent, ip, created_at, last_seen_at, expires_at
			from sessions
			where user_id = ${user.id}
			  and revoked_at is null
			  and expires_at > now()
			order by last_seen_at desc nulls last
		`;
		const sessions = rows.map((s) => ({
			id: s.id,
			user_agent: s.user_agent,
			ip: s.ip,
			created_at: s.created_at,
			last_seen_at: s.last_seen_at,
			expires_at: s.expires_at,
			is_current: s.id === user.sid,
		}));
		return json(res, 200, { sessions });
	}

	// DELETE — revoke all other sessions, then rotate the current one so the user
	// stays signed in on this device with a fresh cookie ("log out everywhere else").
	const ua = req.headers['user-agent'] || null;
	const result = await sql`
		update sessions
		set revoked_at = now()
		where user_id = ${user.id}
		  and revoked_at is null
		  and id != ${user.sid}
	`;

	// Rotate the current session so any stolen copy of this cookie is invalidated.
	const newToken = await rotateSession({
		currentSid: user.sid,
		userId: user.id,
		userAgent: ua,
		ip,
	});
	const existing = res.getHeader('set-cookie') || [];
	const arr = Array.isArray(existing) ? existing : [existing];
	res.setHeader('set-cookie', [...arr, sessionCookie(newToken)]);

	return json(res, 200, { revoked: result.count });
});
