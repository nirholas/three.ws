// Owner step-up for commerce decisions an agent must never make for itself
// (approving a change to its own spending limits).
//
// The decide endpoint already requires a browser session plus CSRF, which no
// agent bearer token can present. Step-up adds one fresh proof that the person
// at the keyboard is the owner right now, not a session left open:
//   - password:  the account password, checked against its bcrypt hash;
//   - reauth:    a provider re-authentication from the last five minutes
//                (the __Host-reauth cookie the Google flow sets);
//   - wallet:    an ed25519 signature, from a Solana wallet linked to the
//                account, over a challenge that names the request and the hash
//                of the exact change being approved.
//
// The wallet challenge is stateless: its nonce is an HMAC over the user, the
// request, the payload hash and the expiry, so nothing is stored and a
// signature for one request or one version of a change cannot approve another.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { sql } from '../db.js';
import { env } from '../env.js';
import { verifyPassword } from '../auth.js';
import { readReauth } from '../identities.js';
import { verifySiwsSignature } from '../siws.js';
import { CommerceError } from './assets.js';

export const STEP_UP_TTL_MS = 5 * 60 * 1000;
export const STEP_UP_METHODS = Object.freeze(['password', 'reauth', 'wallet']);

function nonceFor({ userId, requestId, payloadHash, expiresAt }) {
	return createHmac('sha256', env.JWT_SECRET)
		.update(`agent-commerce-step-up:${userId}:${requestId}:${payloadHash}:${expiresAt}`)
		.digest('base64url')
		.slice(0, 32);
}

/** The exact text a wallet signs to approve one request. */
export function stepUpMessage({ userId, requestId, payloadHash, expiresAt }) {
	return [
		'three.ws: approve a spending limit change',
		'',
		`Request: ${requestId}`,
		`Change: ${payloadHash}`,
		`Account: ${userId}`,
		`Nonce: ${nonceFor({ userId, requestId, payloadHash, expiresAt })}`,
		`Expires: ${expiresAt}`,
	].join('\n');
}

/** Which proofs this account can give, and a wallet challenge to sign. */
export async function stepUpChallenge({ userId, requestId, payloadHash, now = Date.now() }) {
	const expiresAt = new Date(now + STEP_UP_TTL_MS).toISOString();
	const [[user], wallets, [google]] = await Promise.all([
		sql`SELECT password_hash IS NOT NULL AS has_password FROM users WHERE id = ${userId}`,
		sql`SELECT address FROM user_wallets WHERE user_id = ${userId} AND chain_type = 'solana' ORDER BY is_primary DESC, created_at ASC LIMIT 10`,
		sql`SELECT 1 AS linked FROM user_identities WHERE user_id = ${userId} AND provider = 'google' LIMIT 1`,
	]);
	return {
		methods: {
			password: Boolean(user?.has_password),
			reauth: Boolean(google),
			wallet: wallets.length > 0,
		},
		wallets: wallets.map((w) => w.address),
		message: stepUpMessage({ userId, requestId, payloadHash, expiresAt }),
		expires_at: expiresAt,
	};
}

function fail(message) {
	return new CommerceError('step_up_failed', message, 401);
}

/**
 * Check one step-up proof. Returns the method that passed, or throws 401.
 * @param {object} o
 * @param {import('http').IncomingMessage} o.req
 * @param {string} o.userId
 * @param {string} o.requestId
 * @param {string} o.payloadHash
 * @param {{ method: string, password?: string, address?: string, signature?: string, expires_at?: string }} o.proof
 */
export async function verifyStepUp({ req, userId, requestId, payloadHash, proof, now = Date.now() }) {
	const method = proof?.method;
	if (!STEP_UP_METHODS.includes(method)) {
		throw new CommerceError('step_up_required', `Confirm it is you first: send step_up.method as one of ${STEP_UP_METHODS.join(', ')}.`, 401);
	}

	if (method === 'password') {
		const plain = typeof proof.password === 'string' ? proof.password : '';
		if (!plain) throw fail('Enter your account password.');
		const [row] = await sql`SELECT password_hash FROM users WHERE id = ${userId}`;
		if (!row?.password_hash) throw fail('This account has no password. Confirm with your wallet or re-authenticate with your sign-in provider.');
		if (!(await verifyPassword(plain, row.password_hash))) throw fail('That password is not correct.');
		return 'password';
	}

	if (method === 'reauth') {
		const provider = await readReauth(req, userId);
		if (!provider) throw fail('No recent re-authentication found. Re-authenticate with your sign-in provider, then approve within five minutes.');
		return `reauth:${provider}`;
	}

	const address = String(proof.address || '').trim();
	const signature = String(proof.signature || '').trim();
	const expiresAt = String(proof.expires_at || '');
	if (!address || !signature || !expiresAt) throw fail('A wallet confirmation needs address, signature and expires_at.');
	const exp = Date.parse(expiresAt);
	if (!Number.isFinite(exp) || exp < now) throw fail('The wallet challenge expired. Request a new one.');
	if (exp > now + STEP_UP_TTL_MS + 60_000) throw fail('That challenge was not issued by three.ws.');
	const [linked] = await sql`
		SELECT 1 FROM user_wallets WHERE user_id = ${userId} AND chain_type = 'solana' AND address = ${address} LIMIT 1
	`;
	if (!linked) throw fail('That wallet is not linked to your account.');
	const message = stepUpMessage({ userId, requestId, payloadHash, expiresAt });
	let ok = false;
	try {
		ok = verifySiwsSignature(message, signature, address);
	} catch {
		ok = false;
	}
	if (!ok) throw fail('The wallet signature does not match this request.');
	return 'wallet';
}

/** Constant-time compare for the payload hash the owner was shown. */
export function sameHash(a, b) {
	const x = Buffer.from(String(a || ''), 'utf8');
	const y = Buffer.from(String(b || ''), 'utf8');
	return x.length === y.length && timingSafeEqual(x, y);
}
