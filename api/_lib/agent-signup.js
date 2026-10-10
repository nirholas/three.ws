// Agent self-signup: the pure verification half (message format, signature,
// clock skew) plus the database half (replay guard, account creation, claim).
//
// An autonomous agent holds an Ed25519 key and nothing else. It signs a short
// text message; this module proves the signature, rejects stale or replayed
// requests, and creates an agent that starts in PAPER mode with strict caps
// until a human claims it. See api/v1/agents/signup.js and claim.js.

import { ed25519 } from '@noble/curves/ed25519.js';
import bs58mod from 'bs58';
import { sql } from './db.js';
import { invalidateApiKey } from './api-key-cache.js';
import { fail } from './gateway.js';
import { randomToken, sha256 } from './crypto.js';
import { createAgentIdentity } from './agent-create.js';
import { mintApiKey } from './api-keys.js';

const bs58 = bs58mod.default || bs58mod;

export const SIGNUP_HEADER = 'three.ws agent signup v1';
/** Accepted distance between the signed timestamp and the server clock. */
export const SKEW_WINDOW_SECONDS = 300;
export const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
export const CLAIM_TTL_DAYS = 30;
export const SIGNUP_KEY_SCOPES = Object.freeze(['read', 'agents:read', 'agents:write', 'wallet:read']);

/**
 * Paper-mode account levers. Every one is an existing platform control, so the
 * runtime enforces them without any signup-specific branch.
 *   spend_limits.frozen      no autonomous outbound spend
 *   trade_limits.kill_switch no discretionary live trades
 *   perps_limits.live_enabled false: perps run on the paper ledger
 * The numeric caps stay in force after a claim until the owner raises them.
 */
export function paperModeMeta(publicKey, nowIso) {
	return {
		autonomy: { origin: 'self_signup', mode: 'paper', public_key: publicKey, signed_up_at: nowIso },
		spend_limits: { daily_usd: 5, per_tx_usd: 1, per_counterparty_daily_usd: 1, withdraw_allowlist: [], frozen: true },
		trade_limits: { per_trade_sol: 0.01, daily_budget_sol: 0.05, max_concurrent: 1, kill_switch: true },
		perps_limits: { live_enabled: false },
	};
}

/** The exact text the agent signs. */
export function buildSignupMessage({ publicKey, name, timestamp, nonce }) {
	return [SIGNUP_HEADER, `public_key: ${publicKey}`, `name: ${name}`, `timestamp: ${timestamp}`, `nonce: ${nonce}`].join('\n');
}

function decodeB58(value, length, what) {
	let bytes;
	try {
		bytes = bs58.decode(String(value));
	} catch {
		fail(400, 'invalid_encoding', `${what} must be base58`);
	}
	if (bytes.length !== length) fail(400, 'invalid_encoding', `${what} must decode to ${length} bytes`);
	return bytes;
}

/**
 * Validate and verify a signup body. Throws coded contract errors; returns the
 * normalized fields on success. Does not touch the database.
 * @param {object} body  { public_key, name, timestamp, nonce, signature }
 * @param {number} [nowMs]
 */
export function verifySignupPayload(body, nowMs = Date.now()) {
	const b = body && typeof body === 'object' ? body : {};
	const name = typeof b.name === 'string' ? b.name.trim() : '';
	if (name.length < 1 || name.length > 100) fail(400, 'validation_error', 'name must be 1-100 characters');
	if (/[\r\n]/.test(name)) fail(400, 'validation_error', 'name must be a single line');
	const nonce = typeof b.nonce === 'string' ? b.nonce : '';
	if (!NONCE_PATTERN.test(nonce)) fail(400, 'validation_error', 'nonce must be 16-64 characters of A-Z a-z 0-9 _ -');
	const timestamp = Number(b.timestamp);
	if (!Number.isInteger(timestamp) || timestamp <= 0) fail(400, 'validation_error', 'timestamp must be unix seconds');
	if (typeof b.public_key !== 'string' || typeof b.signature !== 'string') {
		fail(400, 'validation_error', 'public_key and signature are required (base58)');
	}

	const publicKeyBytes = decodeB58(b.public_key, 32, 'public_key');
	const signatureBytes = decodeB58(b.signature, 64, 'signature');

	const serverTime = Math.floor(nowMs / 1000);
	const skew = timestamp - serverTime;
	if (Math.abs(skew) > SKEW_WINDOW_SECONDS) {
		throw Object.assign(
			new Error(
				`timestamp is ${Math.abs(skew)}s ${skew < 0 ? 'behind' : 'ahead of'} the server clock (allowed ${SKEW_WINDOW_SECONDS}s): sync your clock and sign again; server_time=${serverTime}`,
			),
			{ status: 400, code: 'clock_skew', expose: true, server_time: serverTime },
		);
	}

	const message = buildSignupMessage({ publicKey: b.public_key, name, timestamp, nonce });
	let valid = false;
	try {
		valid = ed25519.verify(signatureBytes, new TextEncoder().encode(message), publicKeyBytes);
	} catch {
		valid = false;
	}
	if (!valid) fail(401, 'bad_signature', 'signature does not match the message for this public_key');

	return { publicKey: b.public_key, name, timestamp, nonce };
}

/** Record a nonce. Returns false when this (key, nonce) was already accepted. */
export async function consumeSignupNonce(publicKey, nonce) {
	await sql`delete from agent_self_signup_nonces where seen_at < now() - interval '1 hour'`.catch(() => {});
	const rows = await sql`
		insert into agent_self_signup_nonces (public_key, nonce) values (${publicKey}, ${nonce})
		on conflict do nothing returning nonce
	`;
	return rows.length === 1;
}

export async function createSelfSignedAgent({ publicKey, name, ip }) {
	const taken = await sql`select agent_id from agent_self_signups where public_key = ${publicKey} limit 1`;
	if (taken.length) fail(409, 'already_signed_up', `this public key already has an agent (${taken[0].agent_id}); sign in with the key it was issued`);

	const nowIso = new Date().toISOString();
	const [user] = await sql`
		insert into users (email, display_name, email_verified)
		values (${`agent-${randomToken(12).toLowerCase()}@signup.three.ws.invalid`}, ${name}, false)
		returning id
	`;

	const created = await createAgentIdentity({
		userId: user.id,
		name,
		description: 'Self-signed agent, running in paper mode until a human claims it.',
		meta: paperModeMeta(publicKey, nowIso),
	});
	if (created.blocked) {
		await sql`delete from users where id = ${user.id}`;
		fail(422, 'identity_blocked', created.blocked.message);
	}
	const agent = created.agent;

	const { row: key, secret: apiKeySecret } = await mintApiKey({ userId: user.id, name: `${name} (signup key)`, scopes: [...SIGNUP_KEY_SCOPES], via: 'agent_signup' });
	const claimCode = `claim_${randomToken(24)}`;
	const claimHash = await sha256(claimCode);
	const expires = new Date(Date.now() + CLAIM_TTL_DAYS * 86_400_000);
	try {
		await sql`
			insert into agent_self_signups (public_key, agent_id, user_id, api_key_id, requested_name, signup_ip, claim_code_hash, claim_expires_at)
			values (${publicKey}, ${agent.id}, ${user.id}, ${key.id}, ${name}, ${ip}, ${claimHash}, ${expires.toISOString()})
		`;
	} catch (err) {
		await sql`delete from users where id = ${user.id}`;
		if (err?.code === '23505') fail(409, 'already_signed_up', 'this public key already has an agent');
		throw err;
	}
	return { agent, user, key, apiKeySecret, claimCode, claimExpiresAt: expires.toISOString() };
}

/**
 * Hand a self-signed agent to a human. Moves the agent and its signup records to
 * `claimerId`, retires the signup key, and lifts the freeze and kill switch while
 * leaving the numeric caps and live-perps lock for the owner to raise.
 */
export async function claimSelfSignedAgent({ claimCode, claimerId }) {
	const hash = await sha256(String(claimCode));
	const [row] = await sql`select * from agent_self_signups where claim_code_hash = ${hash} limit 1`;
	if (!row) fail(404, 'claim_code_invalid', 'no agent matches this claim code');
	if (row.claimed_at) fail(409, 'already_claimed', 'this agent has already been claimed');
	if (new Date(row.claim_expires_at) < new Date()) fail(410, 'claim_code_expired', 'this claim code has expired; the agent can sign up again with a new key');

	const [agent] = await sql`select id, meta from agent_identities where id = ${row.agent_id} limit 1`;
	const meta = { ...(agent.meta || {}) };
	meta.autonomy = { ...(meta.autonomy || {}), mode: 'claimed', claimed_at: new Date().toISOString() };
	meta.spend_limits = { ...(meta.spend_limits || {}), frozen: false };
	meta.trade_limits = { ...(meta.trade_limits || {}), kill_switch: false };

	await sql`update agent_identities set user_id = ${claimerId}, meta = ${JSON.stringify(meta)}::jsonb, updated_at = now() where id = ${row.agent_id}`;
	if (row.api_key_id) {
		await sql`update api_keys set revoked_at = now() where id = ${row.api_key_id} and revoked_at is null`;
		await invalidateApiKey(row.api_key_id);
	}
	await sql`update agent_self_signups set claimed_at = now(), claimed_by = ${claimerId} where id = ${row.id}`;
	return { agentId: row.agent_id, caps: { spend_limits: meta.spend_limits, trade_limits: meta.trade_limits } };
}
