import { getSessionUser } from '../../_lib/auth.js';
import { sha256 } from '../../_lib/crypto.js';
import { sql } from '../../_lib/db.js';
import { cors, json, error, method, wrap } from '../../_lib/http.js';

// Reads __Host-sid (or legacy sid) from the cookie header.
function readCookieToken(req) {
	const cookie = req.headers.cookie || '';
	const m =
		cookie.match(/(?:^|;\s*)__Host-sid=([^;]+)/) ||
		cookie.match(/(?:^|;\s*)sid=([^;]+)/);
	return m ? decodeURIComponent(m[1]) : null;
}

// GET /api/auth/session/list
// Returns all non-revoked sessions for the authenticated user.
// ipHash is the first 8 hex chars of sha256(ip) — raw IP is never returned.
export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const token = readCookieToken(req);
	const currentHash = token ? await sha256(token) : null;

	const rows = await sql`
		select id, created_at, last_seen_at, user_agent, ip, token_hash
		from sessions
		where user_id = ${user.id} and revoked_at is null and expires_at > now()
		order by created_at desc
	`;

	const sessions = await Promise.all(
		rows.map(async (s) => ({
			id: s.id,
			createdAt: s.created_at,
			lastUsedAt: s.last_seen_at,
			userAgent: s.user_agent,
			ipHash: s.ip ? (await sha256(s.ip)).slice(0, 8) : null,
			current: currentHash !== null && s.token_hash === currentHash,
		})),
	);

	return json(res, 200, { ok: true, sessions });
});
