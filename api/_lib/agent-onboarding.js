// Challenge-response signup for autonomous agents.
//
// The agent holds a Solana (ed25519) key and nothing else. It asks the server
// for a challenge bound to its public key, signs the message the server built,
// and posts the signature back. The server never trusts a message the client
// assembled: it rebuilds the text from the stored challenge row, so the nonce,
// the domain and both timestamps are the ones it issued.
//
// Replay protection is the row itself. A challenge is bound to one key, expires
// after CHALLENGE_TTL_SECONDS, and is consumed with a compare-and-set update, so
// a captured signature works exactly once on every instance.
//
// Account creation (user row, custodial wallets, paper-mode caps, API key,
// claim code) is createSelfSignedAgent in agent-signup.js, shared with the
// timestamp flow at /api/v1/agents/signup, so a key can only ever own one
// account whichever door it came through.

import { ed25519 } from '@noble/curves/ed25519.js';
import bs58mod from 'bs58';
import { sql } from './db.js';
import { env } from './env.js';
import { fail } from './gateway.js';
import { randomToken } from './crypto.js';

const bs58 = bs58mod.default || bs58mod;

export const CHALLENGE_HEADER = 'three.ws agent signup v2';
export const CHALLENGE_TTL_SECONDS = 300;

/** The exact text the agent signs. */
export function buildChallengeMessage({ domain, publicKey, nonce, issuedAt, expiresAt }) {
	return [
		CHALLENGE_HEADER,
		`domain: ${domain}`,
		`public_key: ${publicKey}`,
		`nonce: ${nonce}`,
		`issued_at: ${issuedAt}`,
		`expires_at: ${expiresAt}`,
	].join('\n');
}

/** Decode a base58 value to exactly `length` bytes, or throw a 400. */
export function decodeBase58(value, length, what) {
	let bytes;
	try {
		bytes = bs58.decode(String(value));
	} catch {
		fail(400, 'invalid_encoding', `${what} must be base58`);
	}
	if (bytes.length !== length) fail(400, 'invalid_encoding', `${what} must decode to ${length} bytes`);
	return bytes;
}

/** Validate a public key string. Returns it unchanged. */
export function assertPublicKey(value) {
	if (typeof value !== 'string' || !value) fail(400, 'validation_error', 'public_key is required (base58 ed25519)');
	decodeBase58(value, 32, 'public_key');
	return value;
}

/** True when `signature` (base58) is a valid ed25519 signature of `message` by `publicKey`. */
export function verifyChallengeSignature({ message, signature, publicKey }) {
	const sig = decodeBase58(signature, 64, 'signature');
	const key = decodeBase58(publicKey, 32, 'public_key');
	try {
		return ed25519.verify(sig, new TextEncoder().encode(message), key);
	} catch {
		return false;
	}
}

function appDomain() {
	return new URL(env.APP_ORIGIN).host;
}

/** Issue a single-use challenge bound to `publicKey`. */
export async function issueChallenge({ publicKey, ip, now = new Date() }) {
	sql`delete from agent_signup_challenges where expires_at < now() - interval '1 hour'`.catch(() => {});
	const nonce = randomToken(24).replace(/[^A-Za-z0-9]/g, '').slice(0, 32);
	const issuedAt = now.toISOString();
	const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_SECONDS * 1000).toISOString();
	await sql`
		insert into agent_signup_challenges (nonce, public_key, ip, issued_at, expires_at)
		values (${nonce}, ${publicKey}, ${ip}, ${issuedAt}, ${expiresAt})
	`;
	const domain = appDomain();
	return {
		nonce,
		message: buildChallengeMessage({ domain, publicKey, nonce, issuedAt, expiresAt }),
		issued_at: issuedAt,
		expires_at: expiresAt,
		ttl_seconds: CHALLENGE_TTL_SECONDS,
		domain,
	};
}

/**
 * Redeem a challenge: the nonce must exist for this key, be unexpired and
 * unconsumed, and the signature must verify over the message rebuilt from the
 * stored row. A bad signature does not burn the nonce, so a typo is retryable;
 * a good one burns it atomically.
 */
export async function redeemChallenge({ publicKey, nonce, signature, now = new Date() }) {
	if (typeof nonce !== 'string' || !/^[A-Za-z0-9]{16,64}$/.test(nonce)) {
		fail(400, 'validation_error', 'nonce is required: request a challenge first');
	}
	if (typeof signature !== 'string' || !signature) fail(400, 'validation_error', 'signature is required (base58)');
	const [row] = await sql`
		select nonce, public_key, issued_at, expires_at, consumed_at
		from agent_signup_challenges where nonce = ${nonce} limit 1
	`;
	if (!row || row.public_key !== publicKey) fail(400, 'invalid_nonce', 'unknown nonce for this public key: request a new challenge');
	if (row.consumed_at) fail(409, 'nonce_reused', 'this challenge was already used: request a new one');
	if (new Date(row.expires_at).getTime() <= now.getTime()) fail(410, 'nonce_expired', 'this challenge expired: request a new one');

	const message = buildChallengeMessage({
		domain: appDomain(),
		publicKey,
		nonce,
		issuedAt: new Date(row.issued_at).toISOString(),
		expiresAt: new Date(row.expires_at).toISOString(),
	});
	if (!verifyChallengeSignature({ message, signature, publicKey })) {
		fail(401, 'bad_signature', 'signature does not match the challenge message for this public_key');
	}
	const burned = await sql`
		update agent_signup_challenges set consumed_at = now()
		where nonce = ${nonce} and public_key = ${publicKey} and consumed_at is null and expires_at > ${now.toISOString()}
		returning nonce
	`;
	if (burned.length !== 1) fail(409, 'nonce_reused', 'this challenge was already used: request a new one');
}

/** New self-signed accounts in the last 24 hours. */
export async function signupsInLastDay() {
	const [row] = await sql`select count(*)::int as n from agent_self_signups where created_at > now() - interval '24 hours'`;
	return row?.n ?? 0;
}

/** Refuse when the rolling daily account ceiling is reached. */
export async function assertUnderDailyCap() {
	const cap = env.AGENT_SIGNUP_DAILY_CAP;
	if ((await signupsInLastDay()) >= cap) {
		fail(429, 'daily_cap_reached', `the platform accepts at most ${cap} new agent accounts per day and today's are taken: retry in a few hours`);
	}
}

/**
 * Tie the new account to its wallet so Sign-In with Solana with the same key
 * reaches it. Returns false when the address already belongs to another account.
 */
export async function linkSignupWallet({ userId, publicKey }) {
	const rows = await sql`
		insert into user_wallets (user_id, address, chain_type, is_primary)
		values (${userId}, ${publicKey}, 'solana', true)
		on conflict (address) do nothing
		returning address
	`;
	return rows.length === 1;
}

/** The account that already owns `publicKey` as a wallet, if any. */
export async function walletOwner(publicKey) {
	const [row] = await sql`select user_id from user_wallets where address = ${publicKey} limit 1`;
	return row?.user_id ?? null;
}
