import { getSessionUser, createSession, sessionCookie } from '../../_lib/auth.js';
import { sha256 } from '../../_lib/crypto.js';
import { sql } from '../../_lib/db.js';
import { cors, json, error, method, wrap } from '../../_lib/http.js';
import { clientIp } from '../../_lib/rate-limit.js';

// Reads __Host-sid (or legacy sid) from the cookie header.
function readCookieToken(req) {
	const cookie = req.headers.cookie || '';
	const m =
		cookie.match(/(?:^|;\s*)__Host-sid=([^;]+)/) ||
		cookie.match(/(?:^|;\s*)sid=([^;]+)/);
	return m ? decodeURIComponent(m[1]) : null;
}

// POST /api/auth/session/refresh
// Rotates the current browser session: revokes the old row, issues a fresh one
// for the same user, and sets a new __Host-sid cookie.
// Rate limit: no matching preset in limits.* and getLimiter is not exported —
// skipped; add limits.sessionRefresh(userId) when available.
export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const token = readCookieToken(req);
	if (!token) return error(res, 401, 'unauthorized', 'no session cookie');

	const oldHash = await sha256(token);
	await sql`update sessions set revoked_at = now() where token_hash = ${oldHash} and revoked_at is null`;

	const newSecret = await createSession({
		userId: user.id,
		userAgent: req.headers['user-agent'] || null,
		ip: clientIp(req),
	});

	res.setHeader('set-cookie', sessionCookie(newSecret));
	return json(res, 200, { ok: true, rotatedAt: new Date().toISOString() });
});
