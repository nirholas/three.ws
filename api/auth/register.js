import { sql } from '../_lib/db.js';
import { hashPassword, createSession, sessionCookie, destroySession } from '../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { parse, registerBody, usernameRegisterBody } from '../_lib/validate.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const ip = clientIp(req);
	const rl = await limits.registerIp(ip);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many signups from this IP');

	const raw = await readJson(req);
	let email, displayName, password;

	if (raw.username && !raw.email) {
		// Username-only registration — synthetic email kept internal, never shown.
		const body = parse(usernameRegisterBody, raw);
		const safe = body.username.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
		email = `${safe}@users.3dagent.local`;
		displayName = body.username;
		password = body.password;

		const existing =
			await sql`select id from users where display_name ilike ${body.username} and deleted_at is null limit 1`;
		if (existing[0]) return error(res, 409, 'username_taken', 'that username is already taken');
	} else {
		const body = parse(registerBody, raw);
		email = body.email;
		displayName = body.display_name ?? null;
		password = body.password;

		const existing =
			await sql`select id from users where email = ${email} and deleted_at is null limit 1`;
		if (existing[0])
			return error(res, 409, 'email_taken', 'an account with this email already exists');
	}

	const hash = await hashPassword(password);
	const [user] = await sql`
		insert into users (email, password_hash, display_name)
		values (${email}, ${hash}, ${displayName})
		returning id, display_name, plan, created_at
	`;

	// Kill any pre-existing planted session cookie before issuing the real one.
	await destroySession(req);

	const token = await createSession({
		userId: user.id,
		userAgent: req.headers['user-agent'],
		ip,
	});
	res.setHeader('set-cookie', sessionCookie(token));
	return json(res, 201, { user });
});
