// Admin two-factor authentication: TOTP (RFC 6238, HMAC-SHA1, 6 digits, 30 s).
//
// Microsoft 365 Certification OS 16 makes MFA on administrative interfaces a
// hard requirement. Every platform admin enrols an authenticator app once at
// /admin/mfa; after that each admin session must pass a TOTP check, and the
// check stays fresh for MFA_FRESH_SEC. requireAdmin (admin.js) and the ops gate
// (ops-auth.js) refuse an admin session without a fresh check.
//
// The shared secret is sealed with secret-box (AES-256-GCM) before it touches
// the database. A code is accepted at most once: the matched time step is
// stored and any code at or before it is refused, so a shoulder-surfed or
// logged code cannot be replayed inside its window.
//
// Emergency switch: ADMIN_MFA_ENFORCE=0 disables the gate (for example if the
// owner loses their authenticator). Every request it waves through is still
// audited by requireAdmin, and turning it off is itself a change-managed env
// update recorded in Cloud Audit Logs.
//
// Schema: api/_lib/migrations/20261116150242_admin_mfa.sql.

import { createHmac, randomBytes } from 'node:crypto';
import { sql } from './db.js';
import { encryptSecret, decryptSecret } from './secret-box.js';

export const MFA_FRESH_SEC = 12 * 60 * 60;
export const TOTP_PERIOD = 30;
export const TOTP_DIGITS = 6;
const ISSUER = 'three.ws';
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function mfaEnforced() {
	return process.env.ADMIN_MFA_ENFORCE !== '0';
}

export function base32Encode(bytes) {
	let bits = 0;
	let value = 0;
	let out = '';
	for (const byte of bytes) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			out += B32[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	if (bits > 0) out += B32[(value << (5 - bits)) & 31];
	return out;
}

export function base32Decode(text) {
	const clean = String(text).toUpperCase().replace(/[\s=-]/g, '');
	let bits = 0;
	let value = 0;
	const out = [];
	for (const ch of clean) {
		const idx = B32.indexOf(ch);
		if (idx === -1) throw new Error('invalid base32 secret');
		value = (value << 5) | idx;
		bits += 5;
		if (bits >= 8) {
			out.push((value >>> (bits - 8)) & 255);
			bits -= 8;
		}
	}
	return Buffer.from(out);
}

function hotp(key, counter) {
	const msg = Buffer.alloc(8);
	msg.writeBigUInt64BE(BigInt(counter));
	const mac = createHmac('sha1', key).update(msg).digest();
	const offset = mac[mac.length - 1] & 0x0f;
	const bin = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** TOTP_DIGITS;
	return String(bin).padStart(TOTP_DIGITS, '0');
}

/** The TOTP code for `key` (raw bytes) at `unixSec`. */
export function generateTotp(key, unixSec) {
	return hotp(key, Math.floor(unixSec / TOTP_PERIOD));
}

/**
 * The time step `code` matches within +/- `window` steps of now, or null.
 * Steps at or before `afterStep` are refused (replay protection).
 */
export function matchTotp(key, code, { nowSec = Math.floor(Date.now() / 1000), window = 1, afterStep = 0 } = {}) {
	if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
	const current = Math.floor(nowSec / TOTP_PERIOD);
	for (let delta = -window; delta <= window; delta++) {
		const step = current + delta;
		if (step <= afterStep) continue;
		if (hotp(key, step) === code) return step;
	}
	return null;
}

export function otpauthUri({ secret, account }) {
	const label = encodeURIComponent(`${ISSUER}:${account}`);
	const params = `secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD}`;
	return `otpauth://totp/${label}?${params}`;
}

/** True when the session passed a TOTP check within MFA_FRESH_SEC. */
export async function sessionHasFreshMfa(sid) {
	if (!sid) return false;
	const rows = await sql`select mfa_verified_at from sessions where id = ${sid} limit 1`;
	const at = rows[0]?.mfa_verified_at;
	if (!at) return false;
	return Date.now() - new Date(at).getTime() < MFA_FRESH_SEC * 1000;
}

/** { enrolled, pending, session_verified_at } for the signed-in admin. */
export async function mfaStatus(user) {
	const [row] = await sql`select confirmed_at from admin_mfa where user_id = ${user.id} limit 1`;
	const [sess] = user.sid ? await sql`select mfa_verified_at from sessions where id = ${user.sid} limit 1` : [];
	return {
		enrolled: Boolean(row?.confirmed_at),
		pending: Boolean(row && !row.confirmed_at),
		session_verified_at: sess?.mfa_verified_at ?? null,
		fresh_seconds: MFA_FRESH_SEC,
	};
}

/**
 * Start (or restart) enrolment. Refuses when an enrolment is already confirmed:
 * replacing a confirmed authenticator needs a verified session first.
 * @returns {Promise<{ secret: string, uri: string } | { error: string }>}
 */
export async function startEnrollment(user, { sessionVerified }) {
	const [row] = await sql`select confirmed_at from admin_mfa where user_id = ${user.id} limit 1`;
	if (row?.confirmed_at && !sessionVerified) return { error: 'already_enrolled' };
	const secret = base32Encode(randomBytes(20));
	const sealed = await encryptSecret(secret);
	await sql`
		insert into admin_mfa (user_id, secret_enc, confirmed_at, last_used_step)
		values (${user.id}, ${sealed}, null, 0)
		on conflict (user_id) do update
		set secret_enc = excluded.secret_enc, confirmed_at = null, last_used_step = 0, updated_at = now()
	`;
	const account = user.email || user.username || user.wallet_address || String(user.id);
	return { secret, uri: otpauthUri({ secret, account }) };
}

/**
 * Check a code for the signed-in admin. On success the matched step is burned,
 * a pending enrolment is confirmed, and the current session is marked verified.
 * @returns {Promise<{ ok: true, confirmed: boolean } | { ok: false, error: string }>}
 */
export async function verifyCode(user, code) {
	const [row] = await sql`select secret_enc, confirmed_at, last_used_step from admin_mfa where user_id = ${user.id} limit 1`;
	if (!row) return { ok: false, error: 'not_enrolled' };
	const secret = await decryptSecret(row.secret_enc);
	if (!secret) return { ok: false, error: 'secret_unreadable' };
	const step = matchTotp(base32Decode(secret), String(code ?? '').trim(), { afterStep: Number(row.last_used_step) || 0 });
	if (step === null) return { ok: false, error: 'invalid_code' };
	const burned = await sql`
		update admin_mfa
		set last_used_step = ${step}, confirmed_at = coalesce(confirmed_at, now()), updated_at = now()
		where user_id = ${user.id} and last_used_step < ${step}
		returning user_id
	`;
	if (!burned.length) return { ok: false, error: 'invalid_code' };
	if (user.sid) await sql`update sessions set mfa_verified_at = now() where id = ${user.sid}`;
	return { ok: true, confirmed: !row.confirmed_at };
}
