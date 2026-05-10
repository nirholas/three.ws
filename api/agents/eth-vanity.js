// /api/agents/:id/eth-vanity — assign / read / delete a CREATE2 vanity record.
//
// Stores the salt + factory + initCode(Hash) the owner ground in the
// browser at /eth-vanity. Unlike the Solana custodial wallet, this record
// holds NO secret material — the predicted address is just a deterministic
// function of (deployer, salt, initCodeHash). The owner deploys the
// contract themselves with their own EVM signer.
//
// Persisted under agent_identities.meta.eth_vanity:
//   {
//     deployer:        "0x…20 bytes…",
//     init_code_hash:  "0x…32 bytes…",
//     init_code:       "0x…" | null,   // optional raw bytecode for deploy convenience
//     salt:            "0x…32 bytes…",
//     predicted_address: "0x…20 bytes…",
//     prefix:          "beef" | null,
//     suffix:          "cafe" | null,
//     deployer_label:  "CreateX" | null,
//     created_at:      ISO,
//     deployed: {
//       chain_id: 8453,
//       tx_hash:  "0x…",
//       at:       ISO
//     } | null
//   }

import { getSessionUser, authenticateBearer, extractBearer } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { cors, json, method, error, readJson } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { keccak_256 } from '@noble/hashes/sha3';

const HEX_RE = /^0x[0-9a-f]+$/i;
const ADDR_RE  = /^0x[0-9a-f]{40}$/i;
const HASH_RE  = /^0x[0-9a-f]{64}$/i;
const TX_RE    = /^0x[0-9a-f]{64}$/i;

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { userId: bearer.userId };
	return null;
}

function _hexToBytes(hex) {
	const h = hex.startsWith('0x') ? hex.slice(2) : hex;
	const out = new Uint8Array(h.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substring(i * 2, i * 2 + 2), 16);
	return out;
}
function _bytesToHex(b) {
	let s = ''; for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
	return s;
}

/**
 * Re-derive the CREATE2 address server-side and verify it matches the
 * client-supplied prediction. Anyone can claim "this salt produces that
 * address"; we don't take their word for it.
 */
function _verifyCreate2(deployer, salt, initCodeHash, predicted) {
	const buf = new Uint8Array(85);
	buf[0] = 0xff;
	buf.set(_hexToBytes(deployer), 1);
	buf.set(_hexToBytes(salt), 21);
	buf.set(_hexToBytes(initCodeHash), 53);
	const digest = keccak_256(buf);
	const derived = '0x' + _bytesToHex(digest.subarray(12));
	return derived.toLowerCase() === predicted.toLowerCase();
}

export default async function handler(req, res, id, action) {
	if (cors(req, res, { methods: 'GET,POST,DELETE,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST', 'DELETE'])) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = req.method === 'GET'
		? await limits.walletRead(auth.userId)
		: await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const [row] = await sql`SELECT id, user_id, meta FROM agent_identities WHERE id = ${id} AND deleted_at IS NULL`;
	if (!row) return error(res, 404, 'not_found', 'agent not found');
	if (row.user_id !== auth.userId) return error(res, 403, 'forbidden', 'not your agent');

	let meta = { ...(row.meta || {}) };

	if (req.method === 'DELETE') {
		delete meta.eth_vanity;
		await sql`UPDATE agent_identities SET meta = ${JSON.stringify(meta)}::jsonb WHERE id = ${id}`;
		return json(res, 200, { data: { ok: true } });
	}

	if (req.method === 'POST') {
		const body = await readJson(req).catch(() => ({}));

		// "Mark as deployed" sub-action — record an on-chain deployment of the
		// existing saved record. Owner deploys with their own signer; this is
		// just metadata we use to hide the Deploy button afterwards.
		if (action === 'deployed' || body.mark_deployed) {
			if (!meta.eth_vanity) return error(res, 404, 'not_found', 'no vanity record to mark deployed');
			const chainId = Number(body.chain_id);
			const txHash = String(body.tx_hash || '');
			if (!Number.isInteger(chainId) || chainId <= 0) return error(res, 400, 'validation_error', 'chain_id must be a positive integer');
			if (!TX_RE.test(txHash)) return error(res, 400, 'validation_error', 'tx_hash must be 0x + 64 hex');
			meta.eth_vanity = {
				...meta.eth_vanity,
				deployed: { chain_id: chainId, tx_hash: txHash.toLowerCase(), at: new Date().toISOString() },
			};
			await sql`UPDATE agent_identities SET meta = ${JSON.stringify(meta)}::jsonb WHERE id = ${id}`;
			return json(res, 200, { data: meta.eth_vanity });
		}

		// Save / replace.
		const deployer = String(body.deployer || '').toLowerCase();
		const salt     = String(body.salt || '').toLowerCase();
		const ich      = String(body.init_code_hash || body.initCodeHash || '').toLowerCase();
		const pred     = String(body.predicted_address || body.address || '').toLowerCase();
		const initCode = body.init_code || body.initCode || null;
		const prefix   = body.prefix ? String(body.prefix).toLowerCase().replace(/^0x/, '') : null;
		const suffix   = body.suffix ? String(body.suffix).toLowerCase().replace(/^0x/, '') : null;
		const label    = body.deployer_label ? String(body.deployer_label).slice(0, 64) : null;

		if (!ADDR_RE.test(deployer))    return error(res, 400, 'validation_error', 'deployer must be 0x + 40 hex');
		if (!HASH_RE.test(salt))        return error(res, 400, 'validation_error', 'salt must be 0x + 64 hex');
		if (!HASH_RE.test(ich))         return error(res, 400, 'validation_error', 'init_code_hash must be 0x + 64 hex');
		if (!ADDR_RE.test(pred))        return error(res, 400, 'validation_error', 'predicted_address must be 0x + 40 hex');
		if (initCode != null && (typeof initCode !== 'string' || !HEX_RE.test(initCode))) {
			return error(res, 400, 'validation_error', 'init_code must be a 0x-prefixed hex string');
		}
		if (prefix && !/^[0-9a-f]+$/.test(prefix)) return error(res, 400, 'validation_error', 'prefix must be hex');
		if (suffix && !/^[0-9a-f]+$/.test(suffix)) return error(res, 400, 'validation_error', 'suffix must be hex');

		// Re-derive server-side — refuse the request if the supplied address
		// doesn't actually match (deployer, salt, initCodeHash).
		if (!_verifyCreate2(deployer, salt, ich, pred)) {
			return error(res, 400, 'validation_error', 'predicted_address does not match keccak256(0xff‖deployer‖salt‖init_code_hash)');
		}

		// If raw init_code was supplied, verify its hash matches.
		if (initCode) {
			const computed = '0x' + _bytesToHex(keccak_256(_hexToBytes(initCode)));
			if (computed.toLowerCase() !== ich) {
				return error(res, 400, 'validation_error', 'init_code does not hash to init_code_hash');
			}
		}

		// If the agent already has a vanity record, require explicit DELETE first
		// (matches the Solana wallet semantics).
		if (meta.eth_vanity) {
			return error(res, 409, 'conflict', 'agent already has an eth vanity record — DELETE /api/agents/:id/eth-vanity first to replace');
		}

		meta.eth_vanity = {
			deployer,
			init_code_hash: ich,
			init_code: initCode || null,
			salt,
			predicted_address: pred,
			prefix,
			suffix,
			deployer_label: label,
			created_at: new Date().toISOString(),
			deployed: null,
		};
		await sql`UPDATE agent_identities SET meta = ${JSON.stringify(meta)}::jsonb WHERE id = ${id}`;
		return json(res, 201, { data: meta.eth_vanity });
	}

	// GET
	if (!meta.eth_vanity) return error(res, 404, 'not_found', 'agent has no eth vanity record');
	return json(res, 200, { data: meta.eth_vanity });
}
