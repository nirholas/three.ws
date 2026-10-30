/**
 * Sealed wallet drops — the protocol primitive.
 *
 * A "drop" is a pre-funded Solana wallet handed to a recipient as an
 * end-to-end-encrypted gift. The wallet's secret key/seed is sealed (ECIES,
 * sealed-envelope.js) so neither the operator, the database, a log, nor anyone
 * but the holder of the matching X25519 private key can open it. This module is
 * the trust-free core shared by the server endpoint, the SDK, and the tests:
 * it derives deterministic drop ids and claim tokens, and pins their behaviour
 * with vectors — never re-implementing the sealed envelope or the cipher.
 *
 * ── Two seal modes (both real, both operator-blind) ──────────────────────────
 *
 * 1. DIRECT SEAL. The sender already knows the recipient's X25519 public key.
 *    The wallet secret is sealed to it at creation; only that recipient's
 *    private key opens it. The link/QR merely points at the (already sealed)
 *    envelope. A leaked link reveals nothing without the recipient's key.
 *
 * 2. CLAIM-TIME SEAL (bearer drop). The sender does not know the recipient. At
 *    creation the server generates a throwaway X25519 "claim keypair", seals
 *    the wallet secret to its PUBLIC key, stores only the sealed envelope +ip
 *    the claim PUBLIC key, and returns the claim SECRET key to the sender ONCE.
 *    That claim secret travels in the URL fragment (`#k=…`) — which browsers
 *    never send to a server — so the link is the bearer token. To claim, the
 *    holder proves possession of the claim secret with a one-time claim TOKEN
 *    (`claimToken = SHA-256("three-drop/claim-token/v1" ‖ dropId ‖ claimSecret)`)
 *    that the server compares against the stored `claimTokenHash`
 *    (`SHA-256("three-drop/claim-token-hash/v1" ‖ claimToken)`). The server can
 *    verify the token without ever learning the claim secret, gates the
 *    exactly-once claim on it, and then releases the sealed envelope — which the
 *    holder opens client-side with the claim secret from the fragment.
 *
 * ── Honest threat model (documented, not hand-waved) ─────────────────────────
 *
 *   • A leaked DATABASE / compromised operator → cannot open any drop. The
 *     server only ever holds the sealed envelope + the claim-token HASH; the
 *     plaintext secret and the claim secret never touch the server.
 *   • A leaked LINK (claim-time-seal mode) → IS bearer access, exactly like a
 *     paper gift card: whoever holds the fragment can claim. This is inherent to
 *     a shareable bearer gift and is stated plainly in the UI. Mitigations:
 *     short expiry, exactly-once claim (a thief and the recipient cannot both
 *     win), and direct-seal mode when the recipient's key is known up front.
 *   • A leaked LINK (direct-seal mode) → reveals nothing: the envelope is sealed
 *     to the recipient's key, which is never in the link.
 *   • Replay / double-claim → impossible: the claim is an atomic compare-and-set
 *     in the store (open→claimed), idempotent on the claim token.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

export const DROP_PROTOCOL_VERSION = 'three-drop/v1';

// Domain separators — every hash is tagged so a digest from one context can
// never be reinterpreted as another (id ≠ claim-token ≠ token-hash).
const TAG_ID = utf8ToBytes('three-drop/id/v1');
const TAG_CLAIM_TOKEN = utf8ToBytes('three-drop/claim-token/v1');
const TAG_CLAIM_HASH = utf8ToBytes('three-drop/claim-token-hash/v1');

/** Funding assets a drop may carry. $THREE is the only *coin*; SOL/USDC are runtime rails. */
export const DROP_ASSETS = Object.freeze(['SOL', 'USDC', 'THREE']);
export const SEAL_MODES = Object.freeze(['direct', 'claim-time']);

function concatBytes(...arrays) {
	let total = 0;
	for (const a of arrays) total += a.length;
	const out = new Uint8Array(total);
	let off = 0;
	for (const a of arrays) {
		out.set(a, off);
		off += a.length;
	}
	return out;
}

/**
 * Deterministic, collision-resistant drop id (24 hex chars / 96 bits). Bound to
 * the sealed address, the funder's nonce, and the seal mode, so two creates can
 * never reuse an id and the id cannot be guessed from the address alone.
 * @param {{ address:string, nonce:string, sealMode:string }} p
 * @returns {string} 24-char lowercase hex
 */
export function deriveDropId({ address, nonce, sealMode }) {
	const h = sha256(
		concatBytes(
			TAG_ID,
			utf8ToBytes(String(address)),
			utf8ToBytes(String(nonce)),
			utf8ToBytes(String(sealMode)),
		),
	);
	return bytesToHex(h).slice(0, 24);
}

/**
 * Derive the one-time claim TOKEN a holder presents to prove possession of the
 * claim secret (claim-time-seal mode). The token is a function of the drop id +
 * the claim secret, so it is unguessable without the secret and useless for any
 * other drop. The holder computes it client-side and sends only the token; the
 * server never sees the claim secret.
 * @param {string} dropId
 * @param {Uint8Array|string} claimSecret 32-byte X25519 secret (bytes or hex/base58 handled by caller→bytes)
 * @returns {string} 64-char hex claim token
 */
export function deriveClaimToken(dropId, claimSecretBytes) {
	if (!(claimSecretBytes instanceof Uint8Array)) {
		throw new Error('claimSecret must be Uint8Array bytes');
	}
	return bytesToHex(
		sha256(concatBytes(TAG_CLAIM_TOKEN, utf8ToBytes(String(dropId)), claimSecretBytes)),
	);
}

/**
 * Hash a claim token for at-rest storage. The server stores ONLY this hash; a
 * presented token is hashed and compared, so a database leak does not yield a
 * usable token (one-way). Mirrors password-hash discipline for a bearer secret.
 * @param {string} claimToken 64-char hex
 * @returns {string} 64-char hex token hash
 */
export function hashClaimToken(claimToken) {
	const tokenBytes = /^[0-9a-f]{64}$/i.test(String(claimToken))
		? hexToBytes(String(claimToken))
		: utf8ToBytes(String(claimToken));
	return bytesToHex(sha256(concatBytes(TAG_CLAIM_HASH, tokenBytes)));
}

/**
 * Constant-time-ish equality for two hex digests of equal length. Avoids an
 * early-exit timing oracle on the claim-token comparison.
 */
export function timingSafeHexEqual(a, b) {
	const x = String(a || '');
	const y = String(b || '');
	if (x.length !== y.length) return false;
	let diff = 0;
	for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
	return diff === 0;
}

/** Validate a drop id shape (24 hex). */
export function isValidDropId(id) {
	return /^[0-9a-f]{24}$/.test(String(id || ''));
}

/** Normalize + validate a funding asset; throws a 400-tagged error on bad input. */
export function normalizeAsset(raw) {
	const a = String(raw || 'SOL').trim().toUpperCase();
	if (!DROP_ASSETS.includes(a)) {
		throw Object.assign(new Error(`asset must be one of ${DROP_ASSETS.join(', ')}`), {
			status: 400,
			code: 'invalid_asset',
		});
	}
	return a;
}
