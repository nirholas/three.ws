/**
 * Grind-bounty market protocol — `three-vanity-bounty/v1`.
 *
 * A two-sided market for HARD vanity addresses. A requester posts a pattern and
 * escrows an x402 bounty; a fleet of independent workers grind in parallel and
 * race to find a matching key. The winner submits a proof and is paid — but the
 * found secret key is sealed to the requester's X25519 key, so the worker who
 * finds it earns the bounty yet NEVER sees the wallet's secret. This module is
 * the pure, isomorphic core both the server (claim verification, pricing,
 * escrow IDs) and the browser worker (building a claim) share, so there is one
 * verified implementation of every rule rather than a prose spec re-coded twice.
 *
 * ── Why a worker can't steal the wallet (secret-blind by construction) ───────
 * The only thing a claim may carry is a `sealedSecret` envelope produced by
 * sealed-envelope.js against the bounty's `recipient` X25519 public key. The
 * server (`verifyClaimEnvelope`) confirms BOTH that the address actually matches
 * the requested pattern AND that the envelope's `recipient` is exactly the
 * bounty's recipient key before it will pay. A worker can open its own sealed
 * envelope only if it holds the requester's PRIVATE key — which it does not — so
 * the plaintext key never touches the worker, the wire, or the operator. The
 * requester opens it later with their private key (openSealed).
 *
 * ── Why exactly one worker is paid (atomic single-winner) ────────────────────
 * The store performs the open→settled transition as a compare-and-set keyed on
 * the bounty id; the FIRST valid claim flips the status and records the winner,
 * every later claim sees `settled` and is rejected as a late/duplicate. This
 * module supplies the deterministic `claimDigest` used as the idempotency anchor
 * so a retried submission of the SAME claim is de-duplicated rather than
 * double-paid, while a DIFFERENT valid claim that lost the race is told so.
 *
 * ── Honest pricing oracle (difficulty → fair USDC bounty) ────────────────────
 * `suggestBountyAtomics` prices a pattern off the SAME geometric difficulty
 * model the grinder advertises (expectedAttempts), so a posted bounty tracks the
 * real expected compute a worker spends — no arbitrary numbers. It returns a
 * floor/suggested/generous trio in USDC atomic units (6 decimals).
 *
 * Pure + isomorphic (no I/O, no Node-only APIs): @noble hashing + the shared
 * vanity primitives only, so it runs identically in the browser worker, the
 * serverless claim handler, and the tests. Behaviour is pinned by fixed vectors
 * in tests/vanity-bounty-protocol.test.js.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes, concatBytes } from '@noble/hashes/utils.js';

import { validatePattern, expectedAttempts, effectiveLength } from './validation.js';
import { SEALED_ENVELOPE_SCHEME } from './sealed-envelope.js';
import { computeRarity } from './rarity.js';

export const BOUNTY_PROTOCOL_VERSION = 'three-vanity-bounty/v1';

// Domain-separation tags so a hash for one purpose can never collide with another.
const TAG_BOUNTY_ID = utf8ToBytes('three-vanity-bounty/id/v1');
const TAG_CLAIM_DIGEST = utf8ToBytes('three-vanity-bounty/claim/v1');

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// USDC atomic units (6 decimals).
const USDC = 1_000_000;

// Pricing model knobs (documented, bounded). A worker's expected cost to grind a
// pattern is proportional to its expected attempts; we anchor the suggested
// bounty to that cost at a published reference rate, then clamp into a sane band
// so a probe pattern isn't free and an astronomically hard one isn't priced into
// the millions by accident. The numbers below are deliberately conservative and
// transparent — the UI shows the full breakdown.
const PRICING = Object.freeze({
	// Reference grind throughput a competent browser/Node fleet sustains, in
	// addresses/sec. Used only to translate "expected attempts" into a wall-clock
	// cost intuition for the suggested bounty — NOT a promise.
	refRatePerSec: 1_500_000,
	// What an hour of that fleet's compute is worth, in USDC atomic units. Posting
	// a bounty worth ~this per expected grind-hour keeps the market liquid: enough
	// to attract a worker, not so much it's exploitable.
	usdcPerGrindHour: 1 * USDC, // $1.00 / expected grind-hour (suggested tier)
	floorAtomics: 50_000, //   $0.05 — minimum any bounty may post (covers a trivial pattern + payout gas headroom)
	maxAtomics: 5_000 * USDC, // $5,000 — hard ceiling so a fat-fingered post can't escrow a fortune
});

/** Coerce to USDC atomic units (integer, 6 decimals), clamped to the legal band. */
function clampAtomics(n) {
	const v = Math.round(Number(n) || 0);
	if (!Number.isFinite(v) || v <= 0) return PRICING.floorAtomics;
	return Math.max(PRICING.floorAtomics, Math.min(PRICING.maxAtomics, v));
}

/**
 * Normalize + validate a requested pattern for a bounty. Throws a 400-tagged
 * error on anything malformed so the server returns a clean rejection. Returns
 * the canonical `{ prefix, suffix, ignoreCase }` plus difficulty metadata.
 * @param {object} input
 * @param {string} [input.prefix]
 * @param {string} [input.suffix]
 * @param {boolean} [input.ignoreCase]
 * @returns {{ prefix:string, suffix:string, ignoreCase:boolean, combinedLength:number,
 *   expectedAttempts:number, effectiveLength:number }}
 */
export function normalizeBountyPattern({ prefix = '', suffix = '', ignoreCase = false } = {}) {
	const pre = typeof prefix === 'string' ? prefix.trim() : '';
	const suf = typeof suffix === 'string' ? suffix.trim() : '';
	const ic = !!ignoreCase;
	if (!pre && !suf) {
		throw bad('a prefix or suffix is required', 'validation_error');
	}
	for (const [label, p] of [['prefix', pre], ['suffix', suf]]) {
		if (!p) continue;
		const v = validatePattern(p);
		if (!v.valid) throw bad(`invalid ${label}: ${v.errors.join('; ')}`, 'validation_error');
	}
	const combinedLength = pre.length + suf.length;
	const attempts = expectedAttempts(pre, suf, ic);
	return {
		prefix: pre,
		suffix: suf,
		ignoreCase: ic,
		combinedLength,
		expectedAttempts: Math.round(attempts),
		effectiveLength: round2(effectiveLength(attempts)),
	};
}

/**
 * Does a Base58 address satisfy a prefix/suffix pattern? Mirrors the WASM grinder
 * and verifiable-grind matcher exactly so the market's anti-cheat is honest.
 * @param {string} address
 * @param {{ prefix?:string, suffix?:string, ignoreCase?:boolean }} pattern
 * @returns {boolean}
 */
export function addressMatchesPattern(address, { prefix = '', suffix = '', ignoreCase = false } = {}) {
	let addr = String(address || '');
	let pre = prefix || '';
	let suf = suffix || '';
	if (!BASE58_RE.test(addr)) return false;
	if (ignoreCase) {
		addr = addr.toLowerCase();
		pre = pre.toLowerCase();
		suf = suf.toLowerCase();
	}
	if (pre && !addr.startsWith(pre)) return false;
	if (suf && !addr.endsWith(suf)) return false;
	return true;
}

/**
 * Honest difficulty→price oracle. Prices a bounty off the same geometric model
 * the grinder advertises, so a posted reward tracks real expected compute.
 * @param {{ prefix?:string, suffix?:string, ignoreCase?:boolean }} pattern
 * @returns {{ floorAtomics:number, suggestedAtomics:number, generousAtomics:number,
 *   expectedAttempts:number, expectedGrindSeconds:number, model:string }}
 */
export function suggestBountyAtomics(pattern) {
	const { prefix = '', suffix = '', ignoreCase = false } = pattern || {};
	const attempts = expectedAttempts(prefix, suffix, ignoreCase);
	const grindSeconds = attempts / PRICING.refRatePerSec;
	const grindHours = grindSeconds / 3600;
	// Suggested = fair value of the expected compute. Floor guarantees a worker
	// always nets something; generous (2.5×) is the "fill it fast" tier.
	const fair = grindHours * PRICING.usdcPerGrindHour;
	const suggested = clampAtomics(Math.max(PRICING.floorAtomics, fair));
	return {
		floorAtomics: PRICING.floorAtomics,
		suggestedAtomics: suggested,
		generousAtomics: clampAtomics(suggested * 2.5),
		maxAtomics: PRICING.maxAtomics,
		expectedAttempts: Math.round(attempts),
		expectedGrindSeconds: Math.round(grindSeconds),
		model: '58^effectiveLength @ refRate',
	};
}

/** Validate that a proposed bounty amount (USDC atomics) is in the legal band. */
export function validateBountyAtomics(atomics) {
	const v = Math.round(Number(atomics));
	if (!Number.isFinite(v) || v < PRICING.floorAtomics) {
		throw bad(
			`bounty amount must be at least ${PRICING.floorAtomics} USDC atomic units ($${(PRICING.floorAtomics / USDC).toFixed(2)})`,
			'amount_too_low',
		);
	}
	if (v > PRICING.maxAtomics) {
		throw bad(
			`bounty amount exceeds the ${PRICING.maxAtomics} USDC-atomic ceiling ($${(PRICING.maxAtomics / USDC).toLocaleString('en-US')})`,
			'amount_too_high',
		);
	}
	return v;
}

/**
 * Deterministic bounty id: SHA-256 over (recipient ‖ pattern ‖ amount ‖ nonce),
 * domain-separated and truncated to a short, URL-safe handle. The nonce makes two
 * otherwise-identical posts distinct; binding the recipient + pattern + amount
 * makes the id self-describing and tamper-evident (a stored bounty whose fields
 * don't re-hash to its id has been altered).
 * @param {object} p
 * @param {string} p.recipient - Base58 X25519 recipient public key.
 * @param {{prefix?:string,suffix?:string,ignoreCase?:boolean}} p.pattern
 * @param {number} p.amountAtomics
 * @param {string} p.nonce - hex/opaque uniqueness nonce.
 * @returns {string} 24-char lowercase-hex id.
 */
export function deriveBountyId({ recipient, pattern, amountAtomics, nonce }) {
	const material = canonical({
		recipient: String(recipient || ''),
		prefix: pattern?.prefix || '',
		suffix: pattern?.suffix || '',
		ignoreCase: !!pattern?.ignoreCase,
		amount: String(amountAtomics),
		nonce: String(nonce || ''),
	});
	return bytesToHex(sha256(concatBytes(TAG_BOUNTY_ID, utf8ToBytes(material)))).slice(0, 24);
}

/**
 * Deterministic claim digest — the idempotency anchor for a submission. Two
 * retries of the SAME claim hash identically (de-duplicated, not double-paid);
 * two DIFFERENT valid keys for the same bounty hash differently so the loser is
 * cleanly told it lost the race. Binds bountyId + address + the sealed envelope's
 * ciphertext, so altering any of them yields a new digest.
 * @param {object} p
 * @param {string} p.bountyId
 * @param {string} p.address - the ground Base58 address.
 * @param {{ epk:string, nonce:string, ciphertext:string }} p.sealedSecret
 * @returns {string} 32-char lowercase-hex digest.
 */
export function claimDigest({ bountyId, address, sealedSecret }) {
	const material = canonical({
		bountyId: String(bountyId || ''),
		address: String(address || ''),
		epk: sealedSecret?.epk || '',
		nonce: sealedSecret?.nonce || '',
		ciphertext: sealedSecret?.ciphertext || '',
	});
	return bytesToHex(sha256(concatBytes(TAG_CLAIM_DIGEST, utf8ToBytes(material)))).slice(0, 32);
}

/**
 * Verify a claim against a bounty WITHOUT the secret — the market's anti-cheat
 * gate. Runs every structural check a server must pass before paying:
 *
 *   1. address is a well-formed Base58 Solana key;
 *   2. address actually matches the bounty's requested pattern;
 *   3. the sealed envelope is well-formed under the supported scheme;
 *   4. the envelope is addressed to the bounty's recipient key (NOT the worker)
 *      — this is what makes the worker secret-blind: it can submit only an
 *      envelope the requester can open, never plaintext.
 *
 * It deliberately CANNOT and does NOT decrypt anything (it has no private key),
 * so a server using it never holds the worker's plaintext either. Returns a
 * per-check audit so the API + UI can show exactly what failed.
 *
 * @param {object} bounty - the stored bounty: { pattern, recipient }.
 * @param {object} claim - { address, sealedSecret }.
 * @returns {{ ok:boolean, checks:Array<{id:string,label:string,pass:boolean,detail:string}>, reason:string }}
 */
export function verifyClaimEnvelope(bounty, claim) {
	const checks = [];
	const add = (id, label, pass, detail) => checks.push({ id, label, pass, detail });

	const address = String(claim?.address || '');
	const env = claim?.sealedSecret;

	// 1. address shape.
	const addrOk = BASE58_RE.test(address);
	add('address-shape', 'Submitted address is a valid Solana public key', addrOk,
		addrOk ? address : 'address is not a 32–44 char Base58 string');

	// 2. pattern match.
	const matchOk = addrOk && addressMatchesPattern(address, bounty?.pattern || {});
	const want = patternLabel(bounty?.pattern);
	add('pattern', 'Address matches the requested pattern', matchOk,
		matchOk ? `${address} satisfies ${want}` : `${address} does NOT satisfy ${want}`);

	// 3. envelope shape.
	const schemeOk = !!env && env.scheme === SEALED_ENVELOPE_SCHEME &&
		typeof env.epk === 'string' && typeof env.nonce === 'string' &&
		typeof env.ciphertext === 'string' && typeof env.recipient === 'string';
	add('envelope', 'Sealed envelope is well-formed', schemeOk,
		schemeOk ? `scheme ${SEALED_ENVELOPE_SCHEME}` : `missing/invalid sealed-envelope fields (need scheme=${SEALED_ENVELOPE_SCHEME}, epk, nonce, ciphertext, recipient)`);

	// 4. recipient binding — the secret-blind invariant.
	const recipientOk = schemeOk && !!bounty?.recipient && env.recipient === bounty.recipient;
	add('sealed-to-requester', 'Secret is sealed to the requester (worker can never open it)', recipientOk,
		recipientOk
			? `envelope recipient matches the bounty's X25519 key ${truncate(bounty.recipient)}`
			: `envelope recipient ${truncate(env?.recipient)} ≠ bounty recipient ${truncate(bounty?.recipient)} — a worker may only submit an envelope the requester can open`);

	const ok = checks.every((c) => c.pass);
	const firstFail = checks.find((c) => !c.pass);
	return { ok, checks, reason: ok ? '' : firstFail?.detail || 'claim failed verification' };
}

/** Human label for a pattern, used in audit detail + UI. */
export function patternLabel(pattern) {
	const pre = pattern?.prefix || '';
	const suf = pattern?.suffix || '';
	return [pre && `prefix "${pre}"`, suf && `suffix "${suf}"`].filter(Boolean).join(' + ') || '(no pattern)';
}

/**
 * Rarity + difficulty summary for a bounty's pattern, reusing the honest rarity
 * model so the board, share cards, and post form all show the same numbers.
 * @param {{prefix?:string,suffix?:string,ignoreCase?:boolean}} pattern
 */
export function bountyDifficulty(pattern) {
	const rarity = computeRarity(pattern || {});
	const oracle = suggestBountyAtomics(pattern || {});
	return {
		expectedAttempts: rarity.expectedAttempts,
		rarityBits: rarity.rarityBits,
		tier: rarity.tier,
		tierLabel: rarity.tierLabel,
		accent: rarity.accent,
		expectedGrindSeconds: oracle.expectedGrindSeconds,
	};
}

export { PRICING, USDC };

// ── helpers ──────────────────────────────────────────────────────────────────

function bad(message, code) {
	return Object.assign(new Error(message), { status: 400, code: code || 'validation_error' });
}

// Deterministic JSON: keys sorted, no whitespace — so a digest is reproducible
// across platforms regardless of object insertion order.
function canonical(obj) {
	const keys = Object.keys(obj).sort();
	return `{${keys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(obj[k])}`).join(',')}}`;
}

function truncate(s) {
	const v = String(s || '');
	return v.length > 14 ? `${v.slice(0, 8)}…${v.slice(-4)}` : v || '(none)';
}

function round2(n) {
	return Math.round(n * 100) / 100;
}
