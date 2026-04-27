// Revoke every session AND every OAuth refresh token for the caller, including
// the current session, and clear the cookie. This fully signs the user out on
// every device and invalidates any OAuth tokens issued to third-party clients.
// Different from DELETE /api/auth/sessions (which keeps the current session).

import { sql } from '../_lib/db.js';
import { getSessionUser, sessionCookie } from '../_lib/auth.js';
import { cors, json, method, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthenticated', 'not signed in');

	const ip = clientIp(req);
	const rl = await limits.authIp(ip);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	// Revoke all active sessions across every device.
	const sessionResult = await sql`
		update sessions
		set revoked_at = now()
		where user_id = ${user.id}
		  and revoked_at is null
	`;

	// Revoke all OAuth refresh tokens so third-party clients can no longer
	// obtain new access tokens on behalf of this user.
	await sql`
		update oauth_refresh_tokens
		set revoked_at = now()
		where user_id = ${user.id}
		  and revoked_at is null
	`;

	const clearCookies = sessionCookie('', { clear: true });
	const existing = res.getHeader('set-cookie') || [];
	const arr = Array.isArray(existing) ? existing : [existing];
	res.setHeader('set-cookie', [...arr, ...clearCookies]);

	return json(res, 200, { ok: true, revoked: sessionResult.count });
});
