import { getSessionUser, createSession, sessionCookie } from '../../_lib/auth.js';
import { sha256 } from '../../_lib/crypto.js';
import { sql } from '../../_lib/db.js';
import { cors, json, error, method, wrap, readJson } from '../../_lib/http.js';
import { clientIp } from '../../_lib/rate-limit.js';

function readCookieToken(req) {
	const cookie = req.headers.cookie || '';
	const m = cookie.match(/(?:^|;\s*)__Host-sid=([^;]+)/) || cookie.match(/(?:^|;\s*)sid=([^;]+)/);
	return m ? decodeURIComponent(m[1]) : null;
}

export default wrap(async (req, res) => {
	const action = req.query?.action;

	if (action === 'list') {
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
	}

	if (action === 'refresh') {
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
	}

	if (action === 'revoke') {
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
	}

	return error(res, 404, 'not_found', 'unknown session action');
});
