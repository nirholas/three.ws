import { sql } from '../_lib/db.js';
import { verifyPassword, createSession, sessionCookie, destroySession } from '../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { parse, loginBody } from '../_lib/validate.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const ip = clientIp(req);
	const rl = await limits.authIp(ip);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many attempts; try again later');

	const body = parse(loginBody, await readJson(req));

	const rows = await sql`
		select id, email, password_hash, display_name, plan, avatar_url
		from users where email = ${body.email} and deleted_at is null limit 1
	`;
	const user = rows[0];
	const ok = user && (await verifyPassword(body.password, user.password_hash));
	if (!ok) return error(res, 401, 'invalid_credentials', 'invalid email or password');

	// Invalidate any pre-existing session tied to the incoming cookie before
	// minting a new one. Defends against session fixation via planted cookies.
	await destroySession(req);

	const token = await createSession({
		userId: user.id,
		userAgent: req.headers['user-agent'],
		ip,
	});
	res.setHeader('set-cookie', sessionCookie(token));
	const { password_hash: _p, ...safe } = user;
	return json(res, 200, { user: safe });
});
