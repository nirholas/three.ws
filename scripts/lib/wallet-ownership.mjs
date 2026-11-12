// Wallet-recovery ownership proof primitives: the exact challenge text a
// claimant signs, the single-use nonce, and the ed25519 signature check.
// Used by scripts/verify-wallet-ownership.mjs; runbook in
// docs/support/stranded-wallet-ownership-proof.md.
//
// verifyWalletSignature takes claimant-supplied strings and must never throw
// on them: every malformed input comes back as { ok: false, reason }.

import { randomBytes } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';

const b58 = bs58.default ?? bs58;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Format check only: nonce strength comes from generateNonce (9 random bytes).
const NONCE_RE = /^[A-Za-z0-9_-]{1,64}$/;
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;
const BASE64_RE = /^[A-Za-z0-9+/_-]+={0,2}$/;

export const CHALLENGE_HEADER = 'three.ws wallet recovery';

// ISO-8601 UTC at seconds precision: 2026-11-04T12:00:00Z.
export function toIsoSeconds(value) {
	const d = value instanceof Date ? value : new Date(value);
	if (typeof value === 'string' && !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
	if (Number.isNaN(d.getTime())) return null;
	return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function isUuid(value) {
	return typeof value === 'string' && UUID_RE.test(value);
}

export function generateNonce() {
	return randomBytes(9).toString('base64url');
}

export function buildChallenge({ agentId, nonce, issuedAt }) {
	if (!isUuid(agentId)) throw new Error(`agent id must be a UUID, got: ${agentId}`);
	if (typeof nonce !== 'string' || !NONCE_RE.test(nonce)) {
		throw new Error('nonce must be 1 to 64 base64url characters');
	}
	const issued = toIsoSeconds(issuedAt);
	if (!issued) throw new Error(`issued time is not a valid ISO-8601 timestamp: ${issuedAt}`);
	return [CHALLENGE_HEADER, `agent: ${agentId.toLowerCase()}`, `nonce: ${nonce}`, `issued: ${issued}`].join('\n');
}

// A Solana address is a base58 encoding of a 32-byte ed25519 public key.
export function decodeAddress(address) {
	if (typeof address !== 'string') return null;
	const trimmed = address.trim();
	if (!trimmed || !BASE58_RE.test(trimmed)) return null;
	try {
		const bytes = b58.decode(trimmed);
		return bytes.length === 32 ? bytes : null;
	} catch {
		return null;
	}
}

// Wallets show signatures as base58 (Phantom, Solflare) or base64 (some CLI
// tools). Accept either as long as it decodes to exactly 64 bytes. The base58
// alphabet is a subset of base64's, so a string made only of base58 characters
// is read as base58 and nothing else: otherwise a truncated base58 signature
// (63 bytes, 86 chars) parses as 64 bytes of base64 about one time in sixteen
// and is reported as a wrong signature instead of a malformed one. Base64 is
// still recognised whenever it carries padding or a character base58 lacks.
export function decodeSignature(signature) {
	if (typeof signature !== 'string') return null;
	const trimmed = signature.trim();
	if (!trimmed) return null;
	if (BASE58_RE.test(trimmed)) {
		try {
			const bytes = b58.decode(trimmed);
			return bytes.length === 64 ? bytes : null;
		} catch {
			// Not valid base58 after all: fall through to base64.
		}
	}
	if (BASE64_RE.test(trimmed)) {
		const normalized = trimmed.replace(/-/g, '+').replace(/_/g, '/');
		const bytes = Buffer.from(normalized, 'base64');
		if (bytes.length === 64 && bytes.toString('base64').replace(/=+$/, '') === normalized.replace(/=+$/, '')) {
			return new Uint8Array(bytes);
		}
	}
	return null;
}

export function verifyWalletSignature({ message, address, signature } = {}) {
	const pub = decodeAddress(address);
	if (!pub) return { ok: false, reason: 'bad_address' };
	const sig = decodeSignature(signature);
	if (!sig) return { ok: false, reason: 'bad_signature_encoding' };
	if (typeof message !== 'string' || !message) return { ok: false, reason: 'signature_invalid' };
	let valid = false;
	try {
		valid = ed25519.verify(sig, new TextEncoder().encode(message), pub);
	} catch {
		valid = false;
	}
	return valid ? { ok: true, reason: null } : { ok: false, reason: 'signature_invalid' };
}

// Address poisoning: an attacker sends dust from an address that matches the
// victim's first and last four characters, hoping it gets copied from history.
export function isLookAlike(candidate, genuine) {
	if (typeof candidate !== 'string' || typeof genuine !== 'string') return false;
	if (candidate === genuine || candidate.length < 8 || genuine.length < 8) return false;
	return candidate.slice(0, 4) === genuine.slice(0, 4) && candidate.slice(-4) === genuine.slice(-4);
}
