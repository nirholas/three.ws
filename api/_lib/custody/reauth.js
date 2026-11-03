// Fresh re-authentication for the few actions that need proof the account
// holder is present right now (private key export).
//
// Two steps, both rows in auth_reauth:
//
//   challenge  the caller picks a method (password, wallet, email_code) and,
//              for wallet and email_code, we issue a nonce or a six-digit code.
//   grant      the caller proves it (password, a SIWS signature over the nonce,
//              or the code). We mint a single-use bearer token, store only its
//              hash, and return the token once. consumeReauthGrant spends it.
//
// A grant is bound to one user and one purpose and lives five minutes. Only a
// browser session may run the ceremony: API keys and OAuth tokens cannot export
// a key, whatever scopes they hold.

import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { sql } from '../db.js';
import { env } from '../env.js';
import { CustodyHttpError } from './auth.js';

export const REAUTH_METHODS = Object.freeze(['password', 'wallet', 'email_code']);
export const REAUTH_PURPOSES = Object.freeze(['export_key']);
export const GRANT_TTL_MS = 5 * 60 * 1000;
export const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;

const hashToken = (token) => createHash('sha256').update(token).digest('hex');
const hashCode = (code, userId, purpose) =>
	createHmac('sha256', env.JWT_SECRET).update(`reauth-code:${userId}:${purpose}:${code}`).digest('hex');

function requireSession(principal) {
	if (!principal || principal.via !== 'session') {
		throw new CustodyHttpError(403, 'session_required', 'This needs you signed in to the three.ws site. API keys and OAuth tokens cannot do it.');
	}
}

function checkPurposeAndMethod(purpose, method) {
	if (!REAUTH_PURPOSES.includes(purpose)) throw new CustodyHttpError(400, 'invalid_purpose', `purpose must be one of ${REAUTH_PURPOSES.join(', ')}`);
	if (!REAUTH_METHODS.includes(method)) throw new CustodyHttpError(400, 'invalid_method', `method must be one of ${REAUTH_METHODS.join(', ')}`);
}

/** The text a wallet signs to prove presence. Bound to the nonce and purpose. */
export function walletChallengeMessage({ purpose, nonce, expiresAt }) {
	return `three.ws re-authentication\nApprove ${purpose}\nNonce ${nonce}\nValid until ${expiresAt}`;
}

/**
 * Open a challenge. password needs none; wallet returns the message to sign;
 * email_code mails a six-digit code and returns only that it was sent.
 */
export async function startReauth({ principal, purpose, method }) {
	requireSession(principal);
	checkPurposeAndMethod(purpose, method);
	const userId = principal.userId;

	if (method === 'password') return { method, purpose };

	if (method === 'wallet') {
		const [u] = await sql`SELECT wallet_address FROM users WHERE id = ${userId}`;
		if (!u?.wallet_address) throw new CustodyHttpError(409, 'no_wallet', 'No wallet is linked to this account. Use your password or an emailed code instead.');
		const nonce = randomBytes(16).toString('hex');
		const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();
		await sql`
			INSERT INTO auth_reauth (user_id, kind, method, purpose, nonce, expires_at)
			VALUES (${userId}, 'challenge', 'wallet', ${purpose}, ${nonce}, ${expiresAt})
		`;
		return { method, purpose, message: walletChallengeMessage({ purpose, nonce, expiresAt }), expires_at: expiresAt };
	}

	const [u] = await sql`SELECT email FROM users WHERE id = ${userId}`;
	if (!u?.email) throw new CustodyHttpError(409, 'no_email', 'This account has no email address to send a code to. Use your password or wallet instead.');
	const [recent] = await sql`
		SELECT count(*)::int AS n FROM auth_reauth
		WHERE user_id = ${userId} AND method = 'email_code' AND kind = 'challenge' AND created_at > now() - interval '10 minutes'
	`;
	if (recent.n >= 5) throw new CustodyHttpError(429, 'too_many_codes', 'Too many codes requested. Wait a few minutes and try again.');
	const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
	const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();
	await sql`
		INSERT INTO auth_reauth (user_id, kind, method, purpose, code_hash, expires_at)
		VALUES (${userId}, 'challenge', 'email_code', ${purpose}, ${hashCode(code, userId, purpose)}, ${expiresAt})
	`;
	const { sendEmail, renderStepUpCode } = await import('../email.js');
	const sent = await sendEmail({
		to: u.email,
		...renderStepUpCode({ code, expiresInMinutes: CHALLENGE_TTL_MS / 60000, action: 'private key export', where: 'the wallet export dialog' }),
	});
	if (sent?.skipped) throw new CustodyHttpError(503, 'email_unavailable', 'Email is not configured on this server. Use your password or wallet instead.');
	return { method, purpose, sent: true, expires_in_seconds: CHALLENGE_TTL_MS / 1000 };
}

async function proveWallet({ userId, purpose, proof }) {
	const [u] = await sql`SELECT wallet_address FROM users WHERE id = ${userId}`;
	if (!u?.wallet_address) throw new CustodyHttpError(409, 'no_wallet', 'No wallet is linked to this account. Use your password or an emailed code instead.');
	const message = String(proof.message || '');
	const m = /^three\.ws re-authentication\nApprove (\S+)\nNonce ([0-9a-f]{32})\nValid until (\S+)$/.exec(message);
	const until = m ? Date.parse(m[3]) : NaN;
	if (!m || m[1] !== purpose || !(until > Date.now())) {
		throw new CustodyHttpError(401, 'reauth_failed', 'That signed message is not for this action, or it has expired.');
	}
	const { verifySiwsSignature } = await import('../siws.js');
	let valid = false;
	try {
		valid = verifySiwsSignature(message, String(proof.signature || ''), u.wallet_address);
	} catch {
		valid = false;
	}
	if (!valid) throw new CustodyHttpError(401, 'reauth_failed', 'That signature was not made by your linked wallet.');
	// Spend the nonce so one signature cannot mint two grants.
	const [spent] = await sql`
		UPDATE auth_reauth SET used_at = now()
		WHERE user_id = ${userId} AND kind = 'challenge' AND method = 'wallet' AND purpose = ${purpose}
		  AND nonce = ${m[2]} AND used_at IS NULL AND expires_at > now()
		RETURNING id
	`;
	if (!spent) throw new CustodyHttpError(401, 'reauth_failed', 'That challenge was already used or has expired. Start again.');
}

async function proveEmailCode({ userId, purpose, proof }) {
	const code = String(proof.code || '').trim();
	if (!/^\d{6}$/.test(code)) throw new CustodyHttpError(400, 'invalid_code', 'Enter the six-digit code from the email.');
	const [row] = await sql`
		SELECT id, code_hash FROM auth_reauth
		WHERE user_id = ${userId} AND kind = 'challenge' AND method = 'email_code' AND purpose = ${purpose}
		  AND used_at IS NULL AND expires_at > now() AND attempts < ${MAX_CODE_ATTEMPTS}
		ORDER BY created_at DESC LIMIT 1
	`;
	if (!row) throw new CustodyHttpError(401, 'reauth_failed', 'No valid code for this action. Request a new one.');
	const expected = Buffer.from(row.code_hash, 'hex');
	const got = Buffer.from(hashCode(code, userId, purpose), 'hex');
	if (expected.length !== got.length || !timingSafeEqual(expected, got)) {
		await sql`UPDATE auth_reauth SET attempts = attempts + 1 WHERE id = ${row.id}`;
		throw new CustodyHttpError(401, 'reauth_failed', 'That code is not correct.');
	}
	const [used] = await sql`UPDATE auth_reauth SET used_at = now() WHERE id = ${row.id} AND used_at IS NULL RETURNING id`;
	if (!used) throw new CustodyHttpError(401, 'reauth_failed', 'That code was already used.');
}

async function provePassword({ userId, proof }) {
	const [u] = await sql`SELECT password_hash FROM users WHERE id = ${userId}`;
	if (!u?.password_hash) throw new CustodyHttpError(409, 'no_password', 'This account has no password. Use your wallet or an emailed code instead.');
	const { verifyPassword } = await import('../auth.js');
	if (typeof proof.password !== 'string' || !proof.password || !(await verifyPassword(proof.password, u.password_hash))) {
		throw new CustodyHttpError(401, 'reauth_failed', 'That password is not correct.');
	}
}

/**
 * Verify the proof and mint a single-use grant. The token is returned once and
 * only its hash is stored.
 * @returns {Promise<{ grant: string, purpose: string, method: string, expires_at: string }>}
 */
export async function completeReauth({ principal, purpose, method, proof = {} }) {
	requireSession(principal);
	checkPurposeAndMethod(purpose, method);
	const userId = principal.userId;
	if (method === 'password') await provePassword({ userId, proof });
	else if (method === 'wallet') await proveWallet({ userId, purpose, proof });
	else await proveEmailCode({ userId, purpose, proof });

	const token = randomBytes(32).toString('base64url');
	const expiresAt = new Date(Date.now() + GRANT_TTL_MS).toISOString();
	await sql`
		INSERT INTO auth_reauth (user_id, kind, method, purpose, token_hash, expires_at)
		VALUES (${userId}, 'grant', ${method}, ${purpose}, ${hashToken(token)}, ${expiresAt})
	`;
	return { grant: token, purpose, method, expires_at: expiresAt };
}

/**
 * Spend a grant: one use, this user, this purpose, unexpired.
 * @throws {CustodyHttpError} 403 step_up_required when there is no valid grant
 */
export async function consumeReauthGrant({ userId, purpose, token }) {
	if (typeof token === 'string' && token.length >= 32 && token.length <= 128) {
		const [row] = await sql`
			UPDATE auth_reauth SET used_at = now()
			WHERE token_hash = ${hashToken(token)} AND user_id = ${userId} AND purpose = ${purpose}
			  AND kind = 'grant' AND used_at IS NULL AND expires_at > now()
			RETURNING method
		`;
		if (row) return row.method;
	}
	throw new CustodyHttpError(403, 'step_up_required', 'Confirm it is you first: re-enter your password, sign with your wallet, or enter an emailed code.', {
		purpose, methods: REAUTH_METHODS,
	});
}
