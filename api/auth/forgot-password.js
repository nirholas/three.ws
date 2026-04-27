import { sql } from '../_lib/db.js';
import { randomToken, sha256 } from '../_lib/crypto.js';
import { cors, json, method, readJson, wrap } from '../_lib/http.js';
import { limits } from '../_lib/rate-limit.js';
import { parse, email } from '../_lib/validate.js';
import { sendPasswordResetEmail } from '../_lib/email.js';
import { z } from 'zod';

const bodySchema = z.object({ email });

const APP_ORIGIN = process.env.APP_ORIGIN || 'https://three.ws';
const EXPIRES_MINUTES = 60;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const body = parse(bodySchema, await readJson(req));

	// Per-email rate limit (anti-enumeration: still respond success on limit hit).
	const rl = await limits.forgotPasswordEmail(body.email);
	if (!rl.success) return json(res, 200, { success: true });

	const rows =
		await sql`select id from users where email = ${body.email} and deleted_at is null limit 1`;
	const user = rows[0];

	if (user) {
		const token = randomToken(32);
		const tokenHash = await sha256(token);
		const expiresAt = new Date(Date.now() + EXPIRES_MINUTES * 60_000);
		await sql`
			insert into password_resets (user_id, token_hash, expires_at)
			values (${user.id}, ${tokenHash}, ${expiresAt.toISOString()})
		`;
		const resetUrl = `${APP_ORIGIN}/reset-password?token=${encodeURIComponent(token)}`;
		// Fire-and-forget; don't await on the critical path.
		sendPasswordResetEmail({
			to: body.email,
			resetUrl,
			expiresInMinutes: EXPIRES_MINUTES,
		}).catch(() => {});
	}

	return json(res, 200, { success: true });
});
