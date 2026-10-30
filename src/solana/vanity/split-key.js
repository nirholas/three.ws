/**
 * Trustless split-key vanity grinding — `three-split-key/v1`.
 *
 * The single biggest reason nobody buys vanity wallets for value: every paid
 * grinder *sees the private key it sells you*. Split-key grinding removes that
 * objection mathematically. It splits the wallet's secret across two parties so
 * that NEITHER the grinder (a pool worker) NOR the operator ever holds — or can
 * reconstruct — the final private key.
 *
 * ── The math (Ed25519 group, basepoint B, scalar order L) ────────────────────
 *   1. The requester picks a secret scalar  a1 ∈ [1, L)  locally and publishes
 *      only  P1 = a1·B  (a public Ed25519 point). a1 NEVER leaves their machine.
 *   2. A worker grinds an *offset* scalar a2, computing candidate addresses
 *           A = P1 + a2·B
 *      and checking each against the requested Base58 pattern. The worker knows
 *      a2 and P1 but NOT a1, so it cannot compute the final secret.
 *   3. On a hit the worker submits (a2, A). The server verifies, with no secret,
 *           P1 + a2·B == A
 *      and that A matches the pattern, then pays the worker. The server learns
 *      a2 but not a1 — it also cannot reconstruct the key.
 *   4. The requester combines  a_final = (a1 + a2) mod L  on their own machine.
 *      Because  a_final·B = a1·B + a2·B = P1 + a2·B = A, the secret scalar
 *      a_final controls exactly the vanity address A, and it only ever exists on
 *      the requester's device. Trustless by construction.
 *
 * Crucially the offset a2 is NOT itself a secret — it is useless without a1 — so
 * unlike the seal-based bounty protocol (which encrypts a full key the worker
 * generated and therefore *saw*), split-key needs no envelope to be safe: the
 * worker simply never possesses the key. This is what makes a pool safe to use
 * for valuable addresses.
 *
 * ── Honest wallet-import tradeoff (surfaced, never hidden) ────────────────────
 * a_final is a *raw Ed25519 scalar*, not a 32-byte seed (you cannot invert SHA-512
 * to find a seed that expands to a chosen scalar — that's preimage-hard). So a
 * split-key wallet is an "expanded" key: it signs perfectly via {@link signWithScalar}
 * / {@link SplitKeySigner} and is a valid Solana account, but it cannot be imported
 * into seed-only wallets (Phantom's "import private key" expects a 64-byte
 * seed||pubkey). Tools that accept an expanded/extended secret key (libsodium
 * `crypto_sign_*` with an external scalar, our SDK signer, server-side signing for
 * an agent's custodial wallet) use it directly. We expose {@link expandedSecretKey}
 * for those and document the limitation rather than papering over it.
 *
 * Pure + isomorphic: @noble/curves + @noble/hashes only, no Node-only APIs, so the
 * identical code runs in the browser grind worker, the serverless verifier, the
 * agent/CLI worker, and the tests. Behaviour is pinned by fixed vectors in
 * tests/vanity-split-key.test.js.
 */

import { ed25519 } from '@noble/curves/ed25519.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import bs58 from 'bs58';

import { addressMatchesPattern } from './bounty-protocol.js';
import { validatePattern } from './validation.js';

export const SPLIT_KEY_PROTOCOL = 'three-split-key/v1';

const Point = ed25519.Point;
const B = Point.BASE;
/** Ed25519 prime-order subgroup order L. */
export const L = Point.Fn.ORDER;

// Domain separation for the deterministic signing-nonce prefix derived from the
// combined scalar (a split-key wallet has no RFC-8032 seed to take a prefix from).
const TAG_SIGN_PREFIX = utf8ToBytes('three-split-key/sign-prefix/v1');

// ── scalar <-> bytes (Ed25519 scalars are little-endian, RFC 8032) ────────────

/** 32-byte little-endian encoding of a scalar already reduced mod L. */
export function scalarToBytes(n) {
	let v = ((n % L) + L) % L;
	const out = new Uint8Array(32);
	for (let i = 0; i < 32; i++) {
		out[i] = Number(v & 0xffn);
		v >>= 8n;
	}
	return out;
}

/** Little-endian 32-byte → bigint, reduced mod L. */
export function bytesToScalar(b) {
	const bytes = typeof b === 'string' ? hexToBytes(b) : b;
	let n = 0n;
	for (let i = bytes.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(bytes[i]);
	return ((n % L) + L) % L;
}

/** A uniformly random nonzero scalar in [1, L). */
export function randomScalar() {
	// Rejection-free: 512 bits reduced mod L has negligible bias; matches how
	// Ed25519 derives its own scalars. Guarantee nonzero (probability of 0 is ~2^-512).
	const wide = new Uint8Array(64);
	cryptoRandom(wide);
	let n = 0n;
	for (let i = wide.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(wide[i]);
	const s = n % L;
	return s === 0n ? 1n : s;
}

function cryptoRandom(buf) {
	const g = globalThis.crypto || (globalThis.require && globalThis.require('crypto').webcrypto);
	if (!g || !g.getRandomValues) throw new Error('split-key: no secure RNG available');
	g.getRandomValues(buf);
	return buf;
}

// ── point (de)serialization ──────────────────────────────────────────────────

/** Parse a public point P1 from Base58 (Solana address form) or hex / bytes. */
export function parsePoint(p1) {
	if (p1 instanceof Point) return p1;
	let bytes;
	if (p1 instanceof Uint8Array) bytes = p1;
	else if (typeof p1 === 'string') {
		const s = p1.trim();
		bytes = /^[0-9a-fA-F]{64}$/.test(s) ? hexToBytes(s) : bs58.decode(s);
	} else {
		throw new Error('parsePoint: expected Base58 string, hex string, or bytes');
	}
	if (bytes.length !== 32) throw new Error('parsePoint: expected a 32-byte Ed25519 point');
	return Point.fromBytes(bytes);
}

/** Base58 address of a point (the Solana public-key form). */
export function pointToAddress(point) {
	return bs58.encode(point.toBytes());
}

// ── requester side: keypair share ────────────────────────────────────────────

/**
 * Generate a requester key share locally. Returns the SECRET scalar a1 (hex, LE)
 * which must never leave the requester, and the PUBLIC point P1 = a1·B (Base58 +
 * hex) which is safe to publish in a bounty so workers can grind offsets against
 * it. This must be called client-side; the server only ever sees `p1`.
 * @returns {{ a1:string, p1:string, p1Hex:string, protocol:string }}
 */
export function generateRequesterShare() {
	const a1 = randomScalar();
	const P1 = B.multiply(a1);
	return {
		a1: bytesToHex(scalarToBytes(a1)),
		p1: pointToAddress(P1),
		p1Hex: bytesToHex(P1.toBytes()),
		protocol: SPLIT_KEY_PROTOCOL,
	};
}

/** Validate a P1 string is a well-formed, non-identity, prime-order Ed25519 point. */
export function isValidP1(p1) {
	try {
		const P = parsePoint(p1);
		if (P.is0()) return false;
		// Reject small-order / torsion points: a malicious P1 could otherwise leak
		// info about offsets. Prime-order check is cheap and decisive.
		return P.isTorsionFree();
	} catch {
		return false;
	}
}

// ── worker side: incremental offset grind ────────────────────────────────────

/**
 * Grind an offset scalar a2 such that `P1 + a2·B` matches the pattern. Uses the
 * standard fast-vanity incrementing trick: seed once with a full scalar mult at a
 * random base offset, then advance by a single point addition (Q += B, a2 += 1)
 * per candidate instead of a fresh multiply — ~12× the field-op throughput.
 *
 * A worker only ever sees a2 and P1, never the requester's a1, so it cannot
 * reconstruct the final key it just helped grind. A distinct random `startOffset`
 * per worker shards the keyspace: two random 256-bit starts cannot collide within
 * any feasible attempt budget, so workers never duplicate effort.
 *
 * @param {object} opts
 * @param {string} opts.p1                 requester public point (Base58/hex)
 * @param {string} [opts.prefix]           Base58 prefix to match
 * @param {string} [opts.suffix]           Base58 suffix to match
 * @param {boolean} [opts.ignoreCase]      case-insensitive match
 * @param {Uint8Array|string} [opts.startOffset]  base offset scalar (LE bytes/hex); random if omitted
 * @param {number} [opts.maxAttempts]      stop after this many candidates (default Infinity)
 * @param {number} [opts.timeBudgetMs]     stop after this many ms (default Infinity)
 * @param {(p:{attempts:number,rate:number})=>void} [opts.onProgress]  progress callback
 * @param {number} [opts.progressEvery]    candidates between progress callbacks (default 4096)
 * @param {{aborted:boolean}|AbortSignal} [opts.signal]  cooperative cancellation
 * @returns {{ found:boolean, offset?:string, address?:string, attempts:number, durationMs:number }}
 */
export function grindSplitKeyOffset(opts = {}) {
	const {
		p1,
		prefix = '',
		suffix = '',
		ignoreCase = false,
		startOffset,
		maxAttempts = Infinity,
		timeBudgetMs = Infinity,
		onProgress,
		progressEvery = 4096,
		signal,
	} = opts;

	const pattern = { prefix, suffix, ignoreCase };
	const P1 = parsePoint(p1);
	let a2 = startOffset != null ? bytesToScalar(startOffset) : randomScalar();
	let Q = P1.add(B.multiply(a2));

	const started = now();
	let attempts = 0;
	let sincePb = 0;

	const aborted = () => (signal instanceof Object && 'aborted' in signal ? signal.aborted : false);

	for (;;) {
		const address = bs58.encode(Q.toBytes());
		attempts++;
		sincePb++;
		if (addressMatchesPattern(address, pattern)) {
			return {
				found: true,
				offset: bytesToHex(scalarToBytes(a2)),
				address,
				attempts,
				durationMs: Math.round(now() - started),
			};
		}
		if (sincePb >= progressEvery) {
			sincePb = 0;
			if (onProgress) {
				const dt = (now() - started) / 1000;
				onProgress({ attempts, rate: dt > 0 ? Math.round(attempts / dt) : 0 });
			}
			if (aborted()) break;
			if (attempts >= maxAttempts) break;
			if (now() - started >= timeBudgetMs) break;
		}
		// Advance one step: next candidate corresponds to offset a2 + 1.
		Q = Q.add(B);
		a2 = (a2 + 1n) % L;
	}
	return { found: false, attempts, durationMs: Math.round(now() - started) };
}

// ── server side: secret-free verification ─────────────────────────────────────

/**
 * Verify a worker's claim WITHOUT any secret: confirm `P1 + offset·B == address`
 * and (optionally) that the address satisfies the pattern. This is the pool's
 * anti-cheat gate — a worker cannot claim a bogus result, and the verifier never
 * holds a private key. Pure point arithmetic, reproducible by anyone.
 *
 * @param {object} p
 * @param {string} p.p1
 * @param {Uint8Array|string} p.offset    offset scalar (LE bytes/hex)
 * @param {string} p.address              claimed Base58 address
 * @param {{prefix?:string,suffix?:string,ignoreCase?:boolean}} [p.pattern]
 * @returns {{ ok:boolean, derivationOk:boolean, patternOk:boolean, derivedAddress:string, reason:string }}
 */
export function verifySplitKeyClaim({ p1, offset, address, pattern }) {
	let derivedAddress = '';
	let derivationOk = false;
	try {
		const P1 = parsePoint(p1);
		const a2 = bytesToScalar(offset);
		if (a2 === 0n) {
			return { ok: false, derivationOk: false, patternOk: false, derivedAddress: '', reason: 'offset scalar is zero' };
		}
		const Q = P1.add(B.multiply(a2));
		derivedAddress = bs58.encode(Q.toBytes());
		derivationOk = derivedAddress === String(address || '');
	} catch (e) {
		return { ok: false, derivationOk: false, patternOk: false, derivedAddress, reason: `derivation error: ${e.message}` };
	}
	const patternOk = pattern ? addressMatchesPattern(derivedAddress, pattern) : true;
	const ok = derivationOk && patternOk;
	let reason = '';
	if (!derivationOk) reason = `P1 + offset·B = ${derivedAddress} ≠ claimed ${address}`;
	else if (!patternOk) reason = `${derivedAddress} does not match the requested pattern`;
	return { ok, derivationOk, patternOk, derivedAddress, reason };
}

// ── requester side: combine + sign ────────────────────────────────────────────

/**
 * Combine the requester's secret a1 with a worker's offset into the final secret
 * scalar a_final = (a1 + offset) mod L. Returns the scalar (LE hex) and the
 * resulting Base58 address (which must equal the ground vanity address). Runs only
 * on the requester's machine.
 * @param {Uint8Array|string} a1
 * @param {Uint8Array|string} offset
 * @returns {{ scalar:string, address:string }}
 */
export function combineScalars(a1, offset) {
	const s1 = bytesToScalar(a1);
	const s2 = bytesToScalar(offset);
	const aFinal = (s1 + s2) % L;
	if (aFinal === 0n) throw new Error('combineScalars: degenerate combined scalar');
	return { scalar: bytesToHex(scalarToBytes(aFinal)), address: pointToAddress(B.multiply(aFinal)) };
}

/**
 * Deterministic 32-byte signing-nonce prefix for a split-key (expanded) wallet.
 * A split-key wallet has no RFC-8032 seed to take the standard prefix from, so we
 * derive one from the secret scalar under a domain tag. It is secret (depends on
 * a_final) and deterministic, giving RFC-8032-style per-message nonces.
 */
function signPrefix(aFinalBytes) {
	return sha512(concatBytes(TAG_SIGN_PREFIX, aFinalBytes)).slice(0, 32);
}

/**
 * The 64-byte "expanded" secret key (scalar ‖ prefix), the format external signers
 * (libsodium external-scalar signing, our SDK) accept. NOT a seed-based Solana
 * keypair — see the module header's wallet-import note.
 * @param {Uint8Array|string} aFinal  LE scalar bytes/hex
 * @returns {Uint8Array} 64 bytes
 */
export function expandedSecretKey(aFinal) {
	const bytes = scalarToBytes(bytesToScalar(aFinal));
	return concatBytes(bytes, signPrefix(bytes));
}

/**
 * Produce a valid Ed25519 signature for `message` using the combined scalar
 * directly (RFC 8032 with an external scalar + derived nonce). The signature
 * verifies against the vanity public key, so a split-key wallet is fully usable
 * for signing even though it has no seed.
 * @param {Uint8Array} message
 * @param {Uint8Array|string} aFinal  LE scalar bytes/hex
 * @returns {Uint8Array} 64-byte signature (R ‖ S)
 */
export function signWithScalar(message, aFinal) {
	const msg = message instanceof Uint8Array ? message : utf8ToBytes(String(message));
	const sBytes = scalarToBytes(bytesToScalar(aFinal));
	const s = bytesToScalar(sBytes);
	const prefix = signPrefix(sBytes);
	const A = B.multiply(s).toBytes();
	const r = mod512(sha512(concatBytes(prefix, msg)));
	const R = B.multiply(r === 0n ? 1n : r).toBytes();
	const k = mod512(sha512(concatBytes(R, A, msg)));
	const S = (r + ((k * s) % L)) % L;
	return concatBytes(R, scalarToBytes(S));
}

/** Verify a signature against a vanity public key (Base58/hex/bytes). */
export function verifySignature(message, signature, publicKey) {
	const msg = message instanceof Uint8Array ? message : utf8ToBytes(String(message));
	const pub = parsePoint(publicKey).toBytes();
	return ed25519.verify(signature, msg, pub);
}

function mod512(hash64) {
	let n = 0n;
	for (let i = hash64.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(hash64[i]);
	return n % L;
}

/**
 * A minimal signer object a requester (or an agent's custodial backend) can use to
 * sign with a split-key wallet without re-deriving anything. `secretKey` is the
 * expanded key from {@link expandedSecretKey}; `publicKey` is the Base58 address.
 */
export class SplitKeySigner {
	constructor(aFinal) {
		this.scalarBytes = scalarToBytes(bytesToScalar(aFinal));
		this.publicKey = pointToAddress(B.multiply(bytesToScalar(this.scalarBytes)));
		this.secretKey = expandedSecretKey(this.scalarBytes);
	}
	sign(message) {
		return signWithScalar(message, this.scalarBytes);
	}
}

// ── validation reused by API/worker ────────────────────────────────────────────

/** Validate a requested split-key pattern; throws a 400-tagged error if malformed. */
export function validateSplitKeyPattern({ prefix = '', suffix = '', ignoreCase = false } = {}) {
	const pre = typeof prefix === 'string' ? prefix.trim() : '';
	const suf = typeof suffix === 'string' ? suffix.trim() : '';
	if (!pre && !suf) throw bad('a prefix or suffix is required');
	for (const [label, p] of [['prefix', pre], ['suffix', suf]]) {
		if (!p) continue;
		const v = validatePattern(p);
		if (!v.valid) throw bad(`invalid ${label}: ${v.errors.join('; ')}`);
	}
	return { prefix: pre, suffix: suf, ignoreCase: !!ignoreCase };
}

function bad(message) {
	return Object.assign(new Error(message), { status: 400, code: 'validation_error' });
}

/** Short, stable fingerprint of a P1 — used as a public bounty/share key. */
export function p1Fingerprint(p1) {
	const P = parsePoint(p1);
	return bytesToHex(sha256(P.toBytes())).slice(0, 16);
}

function now() {
	return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}
