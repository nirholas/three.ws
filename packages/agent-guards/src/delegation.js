// Signed, epoch-bounded spend delegation: a portable, auditable owner
// authorization: "agent X may move at most CAP lamports per EPOCH_SECONDS,
// until NOT_AFTER." The owner signs this statement with their own wallet
// (a Wallet Standard `solana:signMessage`, never a transaction), and ANY
// counterparty can verify the signature and the math themselves: no API
// call to three.ws required. The platform enforces the same cap server-side,
// measured from the agent wallet's REALIZED balance change (never the
// caller's self-reported notional), so an exact-output trade that quietly
// costs more than advertised still can't slip past the ceiling.
//
// Zero-dep by design (mirrors the rest of this package): the ed25519 verify
// below uses only Node's built-in `node:crypto` (Ed25519 support has shipped
// since Node 12 / OpenSSL 1.1.1) plus a ~20-line base58 decoder, so this
// module never pulls in bs58 or a curve library just to check a signature.

import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

// Domain-separates this signature from any other message format a wallet
// might be asked to sign (SIWS, a different app's delegation, etc.), so a
// signature over a SIWS message can never be replayed here and vice versa.
export const DELEGATION_DOMAIN = 'three.ws/agent-spend-delegation/v1';

const FIELD_ORDER = ['agent', 'owner', 'cap_lamports_per_epoch', 'epoch_seconds', 'not_after', 'nonce'];

// ── base58 (Bitcoin/Solana alphabet): decode only, no external dep ────────

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B58_MAP = (() => {
	const m = new Map();
	for (let i = 0; i < B58_ALPHABET.length; i++) m.set(B58_ALPHABET[i], i);
	return m;
})();

function base58Decode(str) {
	if (typeof str !== 'string' || str.length === 0) throw new Error('base58: empty input');
	let num = 0n;
	for (const ch of str) {
		const val = B58_MAP.get(ch);
		if (val === undefined) throw new Error(`base58: invalid character "${ch}"`);
		num = num * 58n + BigInt(val);
	}
	// Leading '1's encode leading zero bytes: count and restore them.
	let leadingZeros = 0;
	for (const ch of str) {
		if (ch === '1') leadingZeros++;
		else break;
	}
	let hex = num.toString(16);
	if (hex.length % 2) hex = `0${hex}`;
	const body = hex === '00' && num === 0n ? [] : Array.from(Buffer.from(hex, 'hex'));
	return new Uint8Array([...new Array(leadingZeros).fill(0), ...body]);
}

// ── canonical fields + signable message ─────────────────────────────────────

/**
 * Normalize + stringify every field in a fixed order. Every numeric field is
 * carried as a decimal string in the signed message (wallets render raw text;
 * a float would risk a cross-client rounding mismatch at the byte level that
 * breaks the signature even though the "value" looks identical).
 */
export function canonicalDelegationFields(d) {
	if (!d || typeof d !== 'object') throw new TypeError('delegation must be an object');
	const out = {};
	for (const key of FIELD_ORDER) {
		if (d[key] === undefined || d[key] === null || d[key] === '') {
			throw new TypeError(`delegation.${key} is required`);
		}
		out[key] = String(d[key]);
	}
	return out;
}

/**
 * The exact UTF-8 text the owner's wallet signs. One field per line, fixed
 * order, human-legible (a hardware wallet or Phantom's sign-message dialog
 * renders this verbatim), the same "plain statement, not opaque bytes"
 * property SIWS uses (see api/_lib/siws.js), so an owner can actually read
 * what they're authorizing before approving it.
 */
export function delegationMessage(d) {
	const f = canonicalDelegationFields(d);
	return [
		DELEGATION_DOMAIN,
		`agent: ${f.agent}`,
		`owner: ${f.owner}`,
		`cap_lamports_per_epoch: ${f.cap_lamports_per_epoch}`,
		`epoch_seconds: ${f.epoch_seconds}`,
		`not_after: ${f.not_after}`,
		`nonce: ${f.nonce}`,
	].join('\n');
}

// Wrap a raw 32-byte Ed25519 public key in the fixed SPKI DER envelope Node's
// crypto module requires to build a verifiable KeyObject. The envelope bytes
// are constant for every Ed25519 key (OID 1.3.101.112); only the 32-byte
// payload varies.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function publicKeyObjectFromBase58(address) {
	const raw = base58Decode(address);
	if (raw.length !== 32) throw new Error(`invalid Solana address: expected 32 bytes, got ${raw.length}`);
	const der = Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(raw)]);
	return createPublicKey({ key: der, format: 'der', type: 'spki' });
}

function decodeSignature(signature) {
	// Wallets encode the 64-byte signature as base58 (Phantom) or base64.
	if (/^[1-9A-HJ-NP-Za-km-z]{87,88}$/.test(signature)) return Buffer.from(base58Decode(signature));
	return Buffer.from(signature, 'base64');
}

/**
 * Verify that `signature` over `delegationMessage(delegation)` was produced
 * by the Ed25519 key at `delegation.owner`. Pure and offline: any
 * counterparty (not just three.ws) can run this to confirm an agent's
 * portable spend authorization without trusting the platform's say-so.
 * Throws on a malformed delegation/signature shape; returns false (never
 * throws) for a well-formed but non-matching signature.
 */
export function verifyDelegationSignature(delegation, signature) {
	const message = delegationMessage(delegation);
	const msgBytes = Buffer.from(message, 'utf8');
	const sigBytes = decodeSignature(signature);
	if (sigBytes.length !== 64) return false;
	const pubKey = publicKeyObjectFromBase58(delegation.owner);
	return cryptoVerify(null, msgBytes, pubKey, sigBytes);
}

// ── pure cap check (no I/O: the server mirrors this over real ledger data) ─

/**
 * Pure epoch-cap arithmetic, identical to the check the server runs over the
 * real realized-spend ledger. `epochSpentLamports` is whatever the caller has
 * already measured as spent in the current rolling epoch window (server:
 * summed from realized `agent_custody_events`, never the agent's own claim).
 * `debitLamports` is the lamport cost of the proposed action. Three outcomes
 * besides "allow": the delegation has lapsed, the clock has run out, or this
 * debit would push the rolling total past the cap.
 */
export function checkDelegationCap({ delegation, nowSec, epochSpentLamports, debitLamports }) {
	const cap = BigInt(delegation.cap_lamports_per_epoch);
	const notAfter = Number(delegation.not_after);
	const now = Number.isFinite(Number(nowSec)) ? Number(nowSec) : Math.floor(Date.now() / 1000);
	if (!Number.isFinite(notAfter) || now > notAfter) {
		return { allow: false, code: 'DELEGATION_EXPIRED', reason: `This delegation expired at ${new Date(notAfter * 1000).toISOString()}.` };
	}
	const spent = BigInt(epochSpentLamports ?? 0);
	const debit = BigInt(debitLamports ?? 0);
	if (spent + debit > cap) {
		return {
			allow: false,
			code: 'DELEGATION_CAP_EXCEEDED',
			reason: `This action would bring the current epoch's realized spend to ${(spent + debit).toString()} lamports, over the delegated cap of ${cap.toString()}.`,
			detail: { spentLamports: spent.toString(), debitLamports: debit.toString(), capLamportsPerEpoch: cap.toString() },
		};
	}
	return { allow: true, code: 'OK', reason: null };
}
