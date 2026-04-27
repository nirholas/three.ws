import { sql } from '../_lib/db.js';
import { hashPassword } from '../_lib/auth.js';
import { sha256 } from '../_lib/crypto.js';
import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { parse, password } from '../_lib/validate.js';
import { z } from 'zod';

const bodySchema = z.object({
	token: z.string().min(16).max(256),
	password,
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	// Reuse generic auth IP limiter — same shape as login/register.
	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many attempts; try again later');

	const body = parse(bodySchema, await readJson(req));
	const tokenHash = await sha256(body.token);

	const rows = await sql`
		select r.id, r.user_id
		from password_resets r
		join users u on u.id = r.user_id
		where r.token_hash = ${tokenHash}
		  and r.consumed_at is null
		  and r.expires_at > now()
		  and u.deleted_at is null
		limit 1
	`;
	const row = rows[0];
	if (!row) return error(res, 400, 'invalid_token', 'reset link is invalid or has expired');

	const hash = await hashPassword(body.password);
	await sql`update users set password_hash = ${hash}, updated_at = now() where id = ${row.user_id}`;
	await sql`update password_resets set consumed_at = now() where id = ${row.id}`;

	// Revoke all existing sessions for safety after a password reset.
	await sql`update sessions set revoked_at = now() where user_id = ${row.user_id} and revoked_at is null`;

	return json(res, 200, { success: true });
});
