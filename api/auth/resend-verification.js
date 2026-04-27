import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { sha256 } from '../_lib/crypto.js';
import { cors, json, method, wrap, error } from '../_lib/http.js';
import { limits } from '../_lib/rate-limit.js';
import { sendVerificationEmail } from '../_lib/email.js';

const EXPIRES_MINUTES = 30;

function generateCode() {
	// 6-digit numeric, zero-padded.
	const n = Math.floor(Math.random() * 1_000_000);
	return n.toString().padStart(6, '0');
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const session = await getSessionUser(req, res);
	if (!session) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.resendVerifyUser(session.id);
	if (!rl.success) return error(res, 429, 'rate_limited', 'please wait before requesting again');

	const rows =
		await sql`select email, email_verified from users where id = ${session.id} and deleted_at is null limit 1`;
	const user = rows[0];
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');
	if (user.email_verified) return json(res, 200, { success: true, already_verified: true });

	// Invalidate any prior unconsumed codes so only the latest one works.
	await sql`update email_verifications set consumed_at = now() where user_id = ${session.id} and consumed_at is null`;

	const code = generateCode();
	const codeHash = await sha256(code);
	const expiresAt = new Date(Date.now() + EXPIRES_MINUTES * 60_000);
	await sql`
		insert into email_verifications (user_id, code_hash, expires_at)
		values (${session.id}, ${codeHash}, ${expiresAt.toISOString()})
	`;

	sendVerificationEmail({
		to: user.email,
		code,
		expiresInMinutes: EXPIRES_MINUTES,
	}).catch(() => {});

	return json(res, 200, { success: true });
});
