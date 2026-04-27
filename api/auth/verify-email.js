import { sql } from '../_lib/db.js';
import { sha256 } from '../_lib/crypto.js';
import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { parse } from '../_lib/validate.js';
import { z } from 'zod';

const bodySchema = z.object({
	code: z
		.string()
		.trim()
		.regex(/^\d{6}$/, '6-digit code required'),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const ip = clientIp(req);
	const rl = await limits.verifyEmailIp(ip);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many attempts; try again later');

	const body = parse(bodySchema, await readJson(req));
	const codeHash = await sha256(body.code);

	const rows = await sql`
		select v.id, v.user_id
		from email_verifications v
		join users u on u.id = v.user_id
		where v.code_hash = ${codeHash}
		  and v.consumed_at is null
		  and v.expires_at > now()
		  and u.deleted_at is null
		limit 1
	`;
	const row = rows[0];
	if (!row) return error(res, 400, 'invalid_code', 'invalid or expired verification code');

	await sql`update email_verifications set consumed_at = now() where id = ${row.id}`;
	await sql`update users set email_verified = true, updated_at = now() where id = ${row.user_id}`;

	return json(res, 200, { success: true });
});
