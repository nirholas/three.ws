// /api/agents/:id/solana
//
// GET    — return the agent's Solana address + SOL balance (owner only).
// POST   — provision a Solana wallet for this agent.
//          • No body: server generates a fresh random keypair.
//          • Body { secret_key, vanity_prefix? }: imports a user-grinded
//            keypair (e.g. from /vanity-wallet.html). Server verifies the
//            secret derives the claimed pubkey and the prefix matches.
//          Idempotent for "no body" + existing wallet (returns existing).
//          409 if importing onto an agent that already has a wallet
//          (call DELETE first to replace).
// DELETE — remove the agent's Solana wallet (clears address + secret).
//
// The encrypted secret never leaves the server. Signing is done by the
// pump.fun action endpoints in api/agents/pumpfun/*.

import { getSessionUser, authenticateBearer, extractBearer } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { cors, json, method, error, readJson } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { generateSolanaAgentWallet } from '../_lib/agent-wallet.js';
import { solanaConnection } from '../_lib/agent-pumpfun.js';
import { Keypair, PublicKey } from '@solana/web3.js';
import { webcrypto } from 'node:crypto';
import { env } from '../_lib/env.js';

const subtle = globalThis.crypto?.subtle || webcrypto.subtle;

// Mirror agent-wallet.js encryption — keep in sync.
async function _deriveKey() {
	const raw = new TextEncoder().encode(env.JWT_SECRET);
	const base = await subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
	return subtle.deriveKey(
		{ name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('agent-wallet-v1'), info: new Uint8Array(0) },
		base,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt'],
	);
}
async function _encryptSecret(plaintext) {
	const key = await _deriveKey();
	const iv = new Uint8Array(12);
	(globalThis.crypto || webcrypto).getRandomValues(iv);
	const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
	const buf = new Uint8Array(iv.length + ct.byteLength);
	buf.set(iv, 0);
	buf.set(new Uint8Array(ct), iv.length);
	return Buffer.from(buf).toString('base64');
}

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { userId: bearer.userId };
	return null;
}

export default async function handler(req, res, id) {
	if (cors(req, res, { methods: 'GET,POST,DELETE,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST', 'DELETE'])) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const [row] = await sql`
		SELECT id, user_id, meta FROM agent_identities
		WHERE id = ${id} AND deleted_at IS NULL
	`;
	if (!row) return error(res, 404, 'not_found', 'agent not found');
	if (row.user_id !== auth.userId) return error(res, 403, 'forbidden', 'not your agent');

	let meta = { ...(row.meta || {}) };

	// ── DELETE ─────────────────────────────────────────────────────────────
	if (req.method === 'DELETE') {
		delete meta.solana_address;
		delete meta.encrypted_solana_secret;
		delete meta.solana_vanity_prefix;
		delete meta.solana_wallet_source;
		await sql`UPDATE agent_identities SET meta = ${JSON.stringify(meta)}::jsonb WHERE id = ${id}`;
		return json(res, 200, { data: { ok: true } });
	}

	// ── POST ───────────────────────────────────────────────────────────────
	if (req.method === 'POST') {
		const body = await readJson(req).catch(() => ({}));
		const importing = body && (body.secret_key || body.vanity_prefix);

		if (importing) {
			// Validate secret_key shape: 64 numbers (Solana CLI / web3.js format).
			const sk = body.secret_key;
			if (!Array.isArray(sk) || sk.length !== 64 || !sk.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
				return error(res, 400, 'validation_error', 'secret_key must be a 64-byte number array');
			}

			let kp;
			try {
				kp = Keypair.fromSecretKey(Uint8Array.from(sk));
			} catch (e) {
				return error(res, 400, 'validation_error', 'secret_key did not parse as a valid Solana keypair');
			}
			const address = kp.publicKey.toBase58();

			if (body.vanity_prefix) {
				if (!BASE58_RE.test(body.vanity_prefix) || body.vanity_prefix.length > 6) {
					return error(res, 400, 'validation_error', 'vanity_prefix is not valid base58 (max 6 chars)');
				}
				if (!address.startsWith(body.vanity_prefix)) {
					return error(res, 400, 'validation_error', 'vanity_prefix does not match the keypair address');
				}
			}

			if (meta.solana_address) {
				return error(res, 409, 'conflict',
					'agent already has a Solana wallet — DELETE /api/agents/:id/solana first to replace');
			}

			const encrypted_secret = await _encryptSecret(Buffer.from(kp.secretKey).toString('base64'));
			meta = {
				...meta,
				solana_address: address,
				encrypted_solana_secret: encrypted_secret,
				solana_wallet_source: 'imported_vanity',
				...(body.vanity_prefix ? { solana_vanity_prefix: body.vanity_prefix } : {}),
			};
			await sql`UPDATE agent_identities SET meta = ${JSON.stringify(meta)}::jsonb WHERE id = ${id}`;
		} else if (!meta.solana_address) {
			// No body, no existing wallet → server generates.
			const sol = await generateSolanaAgentWallet();
			meta = {
				...meta,
				solana_address: sol.address,
				encrypted_solana_secret: sol.encrypted_secret,
				solana_wallet_source: 'generated',
			};
			await sql`UPDATE agent_identities SET meta = ${JSON.stringify(meta)}::jsonb WHERE id = ${id}`;
		}
	}

	if (!meta.solana_address) {
		return error(res, 404, 'not_found', 'agent has no solana wallet — POST to provision');
	}

	const network = (req.query?.network || new URL(req.url, 'http://x').searchParams.get('network') || 'mainnet').toString();
	let lamports = null;
	try {
		const conn = solanaConnection(network === 'devnet' ? 'devnet' : 'mainnet');
		lamports = await conn.getBalance(new PublicKey(meta.solana_address));
	} catch (err) {
		console.error('[agents/solana] balance fetch failed', err);
	}

	return json(res, req.method === 'POST' ? 201 : 200, {
		data: {
			address: meta.solana_address,
			network,
			lamports,
			sol: lamports == null ? null : lamports / 1e9,
			vanity_prefix: meta.solana_vanity_prefix || null,
			source: meta.solana_wallet_source || (meta.encrypted_solana_secret ? 'generated' : null),
		},
	});
}
