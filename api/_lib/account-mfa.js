// Account two-step verification: an authenticator app (TOTP, RFC 6238) plus
// ten single-use recovery codes. Opt-in for every account.
//
// How it gates sign-in: createSession (auth.js) asks userHasMfa(); when the
// account has two-step on and the sign-in path did not itself verify a second
// factor, the session is created PENDING: its token carries PENDING_PREFIX,
// it expires in PENDING_TTL_SEC, and getSessionUser ignores it. The person
// then enters a code at /login/verify, and completePendingSession() swaps the
// pending session for a full one marked mfa_verified_at. Every sign-in path
// (password, Google, X, GitHub, wallets, Telegram, SAML, Microsoft) goes
// through createSession, so none of them skips the second step.
//
// Secrets are sealed with secret-box (AES-256-GCM) before they reach the
// database. Recovery codes are stored only as sha256 hashes. A TOTP code is
// accepted at most once (the matched step is burned), and a pending session
// allows MAX_ATTEMPTS wrong codes before it is revoked.
//
// Schema: api/_lib/migrations/20261116150441_account_mfa.sql.

import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import { sql } from './db.js';
import { encryptSecret, decryptSecret } from './secret-box.js';
import { sha256 } from './crypto.js';
import { base32Encode, base32Decode, matchTotp, otpauthUri } from './totp.js';

export const PENDING_PREFIX = 'mfa_';
export const PENDING_TTL_SEC = 10 * 60;
export const MAX_ATTEMPTS = 5;
export const RECOVERY_CODE_COUNT = 10;

export class MfaError extends Error {
	constructor(status, code, message) {
		super(message);
		this.status = status;
		this.code = code;
	}
}

export function isPendingToken(token) {
	return typeof token === 'string' && token.startsWith(PENDING_PREFIX);
}

/** True when the account finished enrolling an authenticator. */
export async function userHasMfa(userId) {
	if (!userId) return false;
	const rows = await sql`select 1 from user_mfa where user_id = ${userId} and enabled_at is not null limit 1`;
	return rows.length > 0;
}

/** Ten fresh codes like "k3v9q-7xh2m", 50 bits each. */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT) {
	return Array.from({ length: count }, () => {
		const raw = base32Encode(randomBytes(7)).slice(0, 10).toLowerCase();
		return `${raw.slice(0, 5)}-${raw.slice(5)}`;
	});
}

export function normalizeRecoveryCode(code) {
	return String(code ?? '').toLowerCase().replace(/[\s-]/g, '');
}

async function storeRecoveryCodes(userId, codes) {
	await sql`delete from user_mfa_recovery_codes where user_id = ${userId}`;
	for (const code of codes) {
		const hash = await sha256(normalizeRecoveryCode(code));
		await sql`insert into user_mfa_recovery_codes (user_id, code_hash) values (${userId}, ${hash})`;
	}
}

/** What the Security settings panel shows. */
export async function mfaStatus(user) {
	const [row] = await sql`select enabled_at from user_mfa where user_id = ${user.id} limit 1`;
	const [codes] = await sql`
		select count(*)::int as n from user_mfa_recovery_codes where user_id = ${user.id} and used_at is null
	`;
	const [sess] = user.sid ? await sql`select mfa_verified_at from sessions where id = ${user.sid} limit 1` : [];
	const teams = await teamsRequiringMfa(user.id);
	return {
		enabled: Boolean(row?.enabled_at),
		enabled_at: row?.enabled_at ?? null,
		setup_pending: Boolean(row && !row.enabled_at),
		recovery_codes_remaining: codes?.n ?? 0,
		session_verified_at: sess?.mfa_verified_at ?? null,
		teams_requiring: teams,
	};
}

/** Teams this person owns that require two-step verification. */
export async function teamsRequiringMfa(userId) {
	return sql`
		select id, name from teams
		where owner_user_id = ${userId} and require_mfa = true and archived_at is null
		order by created_at
	`;
}

/**
 * Start (or restart) enrolment: a fresh secret, its otpauth URI and a QR code.
 * Refused once two-step is on; turning it off first needs a valid code.
 */
export async function beginSetup(user) {
	const [row] = await sql`select enabled_at from user_mfa where user_id = ${user.id} limit 1`;
	if (row?.enabled_at) throw new MfaError(409, 'already_enabled', 'two-step verification is already on');
	const secret = base32Encode(randomBytes(20));
	const sealed = await encryptSecret(secret);
	await sql`
		insert into user_mfa (user_id, secret_enc, enabled_at, last_used_step)
		values (${user.id}, ${sealed}, null, 0)
		on conflict (user_id) do update
		set secret_enc = excluded.secret_enc, enabled_at = null, last_used_step = 0, updated_at = now()
	`;
	const account = user.email && !user.email.endsWith('@wallet.local')
		? user.email
		: user.username || user.display_name || user.wallet_address || String(user.id);
	const uri = otpauthUri({ secret, account });
	const qr_svg = await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
	return { secret, uri, qr_svg };
}

/** Check a TOTP code against the stored secret and burn its step. */
async function checkTotp(userId, code, { requireEnabled }) {
	const [row] = await sql`select secret_enc, enabled_at, last_used_step from user_mfa where user_id = ${userId} limit 1`;
	if (!row || (requireEnabled && !row.enabled_at)) return null;
	const secret = await decryptSecret(row.secret_enc);
	if (!secret) throw new MfaError(500, 'secret_unreadable', 'the authenticator secret could not be opened; use a recovery code');
	const step = matchTotp(base32Decode(secret), code, { afterStep: Number(row.last_used_step) || 0 });
	if (step === null) return null;
	const burned = await sql`
		update user_mfa set last_used_step = ${step}, updated_at = now()
		where user_id = ${userId} and last_used_step < ${step}
		returning user_id
	`;
	return burned.length ? { step, wasEnabled: Boolean(row.enabled_at) } : null;
}

/** Spend a recovery code. True when it was valid and unused. */
async function useRecoveryCode(userId, code) {
	const normalized = normalizeRecoveryCode(code);
	if (!/^[a-z2-7]{10}$/.test(normalized)) return false;
	const hash = await sha256(normalized);
	const rows = await sql`
		update user_mfa_recovery_codes set used_at = now()
		where user_id = ${userId} and code_hash = ${hash} and used_at is null
		returning id
	`;
	return rows.length > 0;
}

/**
 * Verify a second factor for an enrolled account: a 6-digit authenticator code
 * or a recovery code. Returns the method that passed, or null.
 */
export async function verifyFactor(userId, code) {
	const value = String(code ?? '').trim();
	if (/^\d{6}$/.test(value)) return (await checkTotp(userId, value, { requireEnabled: true })) ? 'totp' : null;
	return (await useRecoveryCode(userId, value)) ? 'recovery' : null;
}

/**
 * Finish enrolment with the first code from the app. Turns two-step on, issues
 * recovery codes (returned once) and marks the current session verified.
 */
export async function confirmSetup(user, code) {
	const value = String(code ?? '').trim();
	const [row] = await sql`select enabled_at from user_mfa where user_id = ${user.id} limit 1`;
	if (!row) throw new MfaError(409, 'no_setup', 'start setup first');
	if (row.enabled_at) throw new MfaError(409, 'already_enabled', 'two-step verification is already on');
	const ok = await checkTotp(user.id, value, { requireEnabled: false });
	if (!ok) throw new MfaError(400, 'invalid_code', 'that code is not right; check the time on your device and try the newest code');
	await sql`update user_mfa set enabled_at = now(), updated_at = now() where user_id = ${user.id}`;
	const codes = generateRecoveryCodes();
	await storeRecoveryCodes(user.id, codes);
	if (user.sid) await sql`update sessions set mfa_verified_at = now() where id = ${user.sid}`;
	return { recovery_codes: codes };
}

/** Turn two-step off. Needs a valid code, and no owned team may require it. */
export async function disableMfa(user, code) {
	if (!(await userHasMfa(user.id))) throw new MfaError(409, 'not_enabled', 'two-step verification is not on');
	const teams = await teamsRequiringMfa(user.id);
	if (teams.length) {
		throw new MfaError(409, 'team_requires_mfa', `turn off "Require two-step verification" on ${teams.map((t) => t.name).join(', ')} first`);
	}
	if (!(await verifyFactor(user.id, code))) throw new MfaError(400, 'invalid_code', 'enter a current authenticator code or an unused recovery code');
	await sql`delete from user_mfa_recovery_codes where user_id = ${user.id}`;
	await sql`delete from user_mfa where user_id = ${user.id}`;
}

/** Replace every recovery code. Needs a valid code; returns the new codes once. */
export async function regenerateRecoveryCodes(user, code) {
	if (!(await userHasMfa(user.id))) throw new MfaError(409, 'not_enabled', 'two-step verification is not on');
	if (!(await verifyFactor(user.id, code))) throw new MfaError(400, 'invalid_code', 'enter a current authenticator code or an unused recovery code');
	const codes = generateRecoveryCodes();
	await storeRecoveryCodes(user.id, codes);
	return { recovery_codes: codes };
}

/** The live pending session behind `token`, or null. */
export async function findPendingSession(token) {
	if (!isPendingToken(token)) return null;
	const hash = await sha256(token);
	const [row] = await sql`
		select s.id, s.user_id, s.mfa_attempts, s.entra_tenant_id, u.email, u.display_name
		from sessions s join users u on u.id = s.user_id
		where s.token_hash = ${hash} and s.mfa_pending = true
		  and s.revoked_at is null and s.expires_at > now() and u.deleted_at is null
		limit 1
	`;
	return row || null;
}

/**
 * Exchange a pending session and a second factor for a full session.
 * @param {{ token: string, code: string, createSession: Function, userAgent?: string|null, ip?: string|null }} opts
 * @returns {Promise<{ token: string, userId: string, method: string, recoveryCodesLeft: number }>}
 */
export async function completePendingSession({ token, code, createSession, userAgent = null, ip = null }) {
	const pending = await findPendingSession(token);
	if (!pending) throw new MfaError(401, 'mfa_expired', 'this sign-in expired; sign in again');
	const [counted] = await sql`
		update sessions set mfa_attempts = mfa_attempts + 1
		where id = ${pending.id} and mfa_pending = true and revoked_at is null
		returning mfa_attempts
	`;
	if (!counted) throw new MfaError(401, 'mfa_expired', 'this sign-in expired; sign in again');
	if (counted.mfa_attempts > MAX_ATTEMPTS) {
		await sql`update sessions set revoked_at = now() where id = ${pending.id}`;
		throw new MfaError(429, 'too_many_attempts', 'too many wrong codes; sign in again');
	}
	const method = await verifyFactor(pending.user_id, code);
	if (!method) throw new MfaError(400, 'invalid_code', 'that code is not right; try the newest code from your app or a recovery code');
	await sql`update sessions set revoked_at = now() where id = ${pending.id}`;
	const full = await createSession({
		userId: pending.user_id,
		userAgent,
		ip,
		entraTenantId: pending.entra_tenant_id || null,
		mfaVerified: true,
	});
	const [left] = await sql`
		select count(*)::int as n from user_mfa_recovery_codes where user_id = ${pending.user_id} and used_at is null
	`;
	return { token: full, userId: pending.user_id, method, recoveryCodesLeft: left?.n ?? 0 };
}

/**
 * Step up a signed-in session that has not passed a second factor (one that
 * predates turning two-step on, or a phone approved by link code) so it counts
 * as verified, for example to open a team that requires two-step.
 * @returns {Promise<string>} the method that passed
 */
export async function stepUpSession(user, code) {
	if (!user?.sid) throw new MfaError(401, 'unauthorized', 'sign in required');
	if (!(await userHasMfa(user.id))) throw new MfaError(409, 'not_enabled', 'turn on two-step verification in Settings first');
	const method = await verifyFactor(user.id, code);
	if (!method) throw new MfaError(400, 'invalid_code', 'that code is not right; try the newest code from your app or a recovery code');
	await sql`update sessions set mfa_verified_at = now() where id = ${user.sid}`;
	return method;
}

/**
 * Whether `viewer` may open a team that requires two-step verification. The
 * viewer is { source, mfaVerified } from resolveAccount; bearer credentials
 * never carry a second factor.
 */
export function viewerPassesTeamMfa(team, viewer) {
	if (!team?.require_mfa) return true;
	return Boolean(viewer && viewer.source === 'session' && viewer.mfaVerified);
}
