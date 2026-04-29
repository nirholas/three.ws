// Consolidated auth endpoint. Dispatches on URL action segment.
// Routes: /api/auth/login, /api/auth/logout, /api/auth/register,
//         /api/auth/me, /api/auth/profile, /api/auth/forgot-password,
//         /api/auth/reset-password, /api/auth/verify-email,
//         /api/auth/resend-verification, /api/auth/logout-everywhere

import { sql } from '../_lib/db.js';
import {
	verifyPassword, hashPassword, createSession, destroySession, sessionCookie,
	getSessionUser, revokeRefreshToken,
} from '../_lib/auth.js';
import { randomToken, sha256 } from '../_lib/crypto.js';
import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { parse, loginBody, registerBody, usernameRegisterBody, username as usernameValidator, displayName, email, password } from '../_lib/validate.js';
import { sendPasswordResetEmail, sendVerificationEmail } from '../_lib/email.js';
import { z } from 'zod';

const APP_ORIGIN = process.env.APP_ORIGIN || 'https://three.ws';

// ── login ─────────────────────────────────────────────────────────────────────

async function handleLogin(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;
	const ip = clientIp(req);
	const rl = await limits.authIp(ip);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many attempts; try again later');
	const body = parse(loginBody, await readJson(req));
	const isEmail = body.email.includes('@');
	const rows = isEmail
		? await sql`select id, email, password_hash, display_name, plan, avatar_url from users where email = ${body.email} and deleted_at is null limit 1`
		: await sql`select id, email, password_hash, display_name, plan, avatar_url from users where display_name ilike ${body.email} and deleted_at is null limit 1`;
	const user = rows[0];
	const ok = user && (await verifyPassword(body.password, user.password_hash));
	if (!ok) return error(res, 401, 'invalid_credentials', 'invalid username/email or password');
	await destroySession(req);
	const token = await createSession({ userId: user.id, userAgent: req.headers['user-agent'], ip });
	res.setHeader('set-cookie', sessionCookie(token));
	const { password_hash: _p, ...safe } = user;
	return json(res, 200, { user: safe });
}

// ── logout ────────────────────────────────────────────────────────────────────

async function handleLogout(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;
	await destroySession(req);
	res.setHeader('set-cookie', sessionCookie('', { clear: true }));
	return json(res, 200, { ok: true });
}

// ── logout-everywhere ─────────────────────────────────────────────────────────

async function handleLogoutEverywhere(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;
	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthenticated', 'not signed in');
	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');
	const sessionResult = await sql`update sessions set revoked_at = now() where user_id = ${user.id} and revoked_at is null`;
	await sql`update oauth_refresh_tokens set revoked_at = now() where user_id = ${user.id} and revoked_at is null`;
	const clearCookies = sessionCookie('', { clear: true });
	const existing = res.getHeader('set-cookie') || [];
	res.setHeader('set-cookie', [...(Array.isArray(existing) ? existing : [existing]), ...clearCookies]);
	return json(res, 200, { ok: true, revoked: sessionResult.count });
}

// ── register ──────────────────────────────────────────────────────────────────

async function handleRegister(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;
	const ip = clientIp(req);
	const rl = await limits.registerIp(ip);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many signups from this IP');
	const raw = await readJson(req);
	let email_val, displayName_val, passwordVal;
	if (raw.username && !raw.email) {
		const body = parse(usernameRegisterBody, raw);
		const safe = body.username.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
		email_val = `${safe}@users.three.ws.local`;
		displayName_val = body.username;
		passwordVal = body.password;
		const existing = await sql`select id from users where display_name ilike ${body.username} and deleted_at is null limit 1`;
		if (existing[0]) return error(res, 409, 'conflict', 'email or username already in use');
	} else {
		const body = parse(registerBody, raw);
		email_val = body.email; displayName_val = body.display_name ?? null; passwordVal = body.password;
		const existing = await sql`select id from users where email = ${email_val} and deleted_at is null limit 1`;
		if (existing[0]) return error(res, 409, 'conflict', 'email or username already in use');
	}
	const hash = await hashPassword(passwordVal);
	const [user] = await sql`insert into users (email, password_hash, display_name) values (${email_val}, ${hash}, ${displayName_val}) returning id, display_name, plan, created_at`;
	await destroySession(req);
	const token = await createSession({ userId: user.id, userAgent: req.headers['user-agent'], ip });
	res.setHeader('set-cookie', sessionCookie(token));
	return json(res, 201, { user });
}

// ── me ────────────────────────────────────────────────────────────────────────

async function handleMe(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;
	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthenticated', 'not signed in');
	return json(res, 200, { user });
}

// ── profile ───────────────────────────────────────────────────────────────────

const profileSchema = z.object({
	username: usernameValidator.optional(),
	display_name: displayName.optional(),
}).refine((b) => b.username !== undefined || b.display_name !== undefined, { message: 'at least one field required' });

async function handleProfile(req, res) {
	if (cors(req, res, { methods: 'PATCH,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['PATCH'])) return;
	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthenticated', 'not signed in');
	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');
	const body = parse(profileSchema, await readJson(req));
	if (body.username) {
		const taken = await sql`select id from users where lower(username) = ${body.username.toLowerCase()} and id != ${user.id} and deleted_at is null limit 1`;
		if (taken[0]) return error(res, 409, 'conflict', 'username already taken');
	}
	const [updated] = await sql`update users set username = coalesce(${body.username ?? null}, username), display_name = coalesce(${body.display_name ?? null}, display_name), updated_at = now() where id = ${user.id} and deleted_at is null returning id, display_name, username`;
	return json(res, 200, { user: updated });
}

// ── forgot-password ───────────────────────────────────────────────────────────

const forgotSchema = z.object({ email });

async function handleForgotPassword(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;
	const body = parse(forgotSchema, await readJson(req));
	const rl = await limits.forgotPasswordEmail(body.email);
	if (!rl.success) return json(res, 200, { success: true });
	const rows = await sql`select id from users where email = ${body.email} and deleted_at is null limit 1`;
	if (rows[0]) {
		const token = randomToken(32);
		const tokenHash = await sha256(token);
		const expiresAt = new Date(Date.now() + 60 * 60_000);
		await sql`insert into password_resets (user_id, token_hash, expires_at) values (${rows[0].id}, ${tokenHash}, ${expiresAt.toISOString()})`;
		sendPasswordResetEmail({ to: body.email, resetUrl: `${APP_ORIGIN}/reset-password?token=${encodeURIComponent(token)}`, expiresInMinutes: 60 }).catch(() => {});
	}
	return json(res, 200, { success: true });
}

// ── reset-password ────────────────────────────────────────────────────────────

const resetSchema = z.object({ token: z.string().min(16).max(256), password });

async function handleResetPassword(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;
	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many attempts; try again later');
	const body = parse(resetSchema, await readJson(req));
	const tokenHash = await sha256(body.token);
	const rows = await sql`select r.id, r.user_id from password_resets r join users u on u.id = r.user_id where r.token_hash = ${tokenHash} and r.consumed_at is null and r.expires_at > now() and u.deleted_at is null limit 1`;
	if (!rows[0]) return error(res, 400, 'invalid_token', 'reset link is invalid or has expired');
	const hash = await hashPassword(body.password);
	await sql`update users set password_hash = ${hash}, updated_at = now() where id = ${rows[0].user_id}`;
	await sql`update password_resets set consumed_at = now() where id = ${rows[0].id}`;
	await sql`update sessions set revoked_at = now() where user_id = ${rows[0].user_id} and revoked_at is null`;
	return json(res, 200, { success: true });
}

// ── verify-email ──────────────────────────────────────────────────────────────

const verifyEmailSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, '6-digit code required') });

async function handleVerifyEmail(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;
	const rl = await limits.verifyEmailIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many attempts; try again later');
	const body = parse(verifyEmailSchema, await readJson(req));
	const codeHash = await sha256(body.code);
	const rows = await sql`select v.id, v.user_id from email_verifications v join users u on u.id = v.user_id where v.code_hash = ${codeHash} and v.consumed_at is null and v.expires_at > now() and u.deleted_at is null limit 1`;
	if (!rows[0]) return error(res, 400, 'invalid_code', 'invalid or expired verification code');
	await sql`update email_verifications set consumed_at = now() where id = ${rows[0].id}`;
	await sql`update users set email_verified = true, updated_at = now() where id = ${rows[0].user_id}`;
	return json(res, 200, { success: true });
}

// ── resend-verification ───────────────────────────────────────────────────────

async function handleResendVerification(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;
	const session = await getSessionUser(req);
	if (!session) return error(res, 401, 'unauthorized', 'sign in required');
	const rl = await limits.resendVerifyUser(session.id);
	if (!rl.success) return error(res, 429, 'rate_limited', 'please wait before requesting again');
	const rows = await sql`select email, email_verified from users where id = ${session.id} and deleted_at is null limit 1`;
	if (!rows[0]) return error(res, 401, 'unauthorized', 'sign in required');
	if (rows[0].email_verified) return json(res, 200, { success: true, already_verified: true });
	await sql`update email_verifications set consumed_at = now() where user_id = ${session.id} and consumed_at is null`;
	const code = Math.floor(Math.random() * 1_000_000).toString().padStart(6, '0');
	const codeHash = await sha256(code);
	const expiresAt = new Date(Date.now() + 30 * 60_000);
	await sql`insert into email_verifications (user_id, code_hash, expires_at) values (${session.id}, ${codeHash}, ${expiresAt.toISOString()})`;
	sendVerificationEmail({ to: rows[0].email, code, expiresInMinutes: 30 }).catch(() => {});
	return json(res, 200, { success: true });
}

// ── dispatcher ────────────────────────────────────────────────────────────────

const DISPATCH = {
	login:                 handleLogin,
	logout:                handleLogout,
	'logout-everywhere':   handleLogoutEverywhere,
	register:              handleRegister,
	me:                    handleMe,
	profile:               handleProfile,
	'forgot-password':     handleForgotPassword,
	'reset-password':      handleResetPassword,
	'verify-email':        handleVerifyEmail,
	'resend-verification': handleResendVerification,
};

export default wrap(async (req, res) => {
	const action = req.query?.action ?? new URL(req.url, 'http://x').pathname.split('/').pop();
	const fn = DISPATCH[action];
	if (!fn) return error(res, 404, 'not_found', `unknown action: ${action}`);
	return fn(req, res);
});
