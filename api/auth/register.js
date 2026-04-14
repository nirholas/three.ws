import { sql } from '../_lib/db.js';
import { hashPassword, createSession, sessionCookie } from '../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { parse, registerBody } from '../_lib/validate.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const ip = clientIp(req);
	const rl = await limits.registerIp(ip);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many signups from this IP');

	const body = parse(registerBody, await readJson(req));

	const existing = await sql`select id from users where email = ${body.email} limit 1`;
	if (existing[0]) return error(res, 409, 'email_taken', 'an account with this email already exists');

	const hash = await hashPassword(body.password);
	const [user] = await sql`
		insert into users (email, password_hash, display_name)
		values (${body.email}, ${hash}, ${body.display_name ?? null})
		returning id, email, display_name, plan, created_at
	`;

	const token = await createSession({
		userId: user.id,
		userAgent: req.headers['user-agent'],
		ip,
	});
	res.setHeader('set-cookie', sessionCookie(token));
	return json(res, 201, { user });
});
