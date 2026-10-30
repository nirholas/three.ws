/**
 * Grind-to-earn pool protocol — `three-grind-pool/v1`.
 *
 * The pure, isomorphic rules of the decentralized grinding pool: how the offset
 * keyspace is sharded across workers, how a worker proves real contributed work
 * (proof-of-contribution shares), and how a bounty's escrow is split fairly among
 * the winner and every honest contributor. The server (claim/settlement handler),
 * the Colyseus coordination room, the browser/agent workers, and the tests all
 * import this one module so there is a single verified implementation of every
 * economic and anti-cheat rule.
 *
 * ── Sharding (no duplicated effort, resumable) ────────────────────────────────
 * For split-key grinding the keyspace is the space of offset scalars a2. A worker
 * is handed a distinct base offset derived deterministically from
 * (bountyId, workerId, shardIndex); it then walks a2, a2+1, a2+2, … by single
 * point additions. Two random 256-bit base offsets cannot collide within any
 * feasible attempt budget, so workers never grind the same region. Determinism
 * lets the room reassign a shard after a disconnect and lets a worker resume
 * exactly where a fresh shard begins.
 *
 * ── Proof-of-contribution shares (anti-freeloader, anti-sybil) ────────────────
 * You cannot trust a worker's self-reported attempt count. Like a mining pool, a
 * worker proves work by submitting *shares*: offsets whose derived address clears
 * an easy target — `leadingZeroBits(sha256(address)) >= shareBits`. Each share is
 * a verifiable proof that the worker evaluated ~2^shareBits candidates *against
 * this bounty's P1* (a share is bound to P1, so it can't be precomputed or reused
 * on another bounty). The server verifies a share with one secret-free point check
 * plus a hash, then credits the worker proportionally. Splitting into many sybil
 * identities yields the same total shares as one identity — payout tracks real
 * work, not identity count — so sybils gain nothing.
 *
 * ── Fair, conservative payout split ───────────────────────────────────────────
 * On a verified win the escrow is divided: a transparent platform fee, a winner
 * bonus to the finder (who did the decisive work and bore the submit), and the
 * remainder distributed pro-rata across ALL share-holders. Refund-on-expiry returns
 * the full escrow to the requester (the platform fee is only ever taken on success).
 * All arithmetic is integer atomics and provably conserves the escrow to the last
 * unit (rounding dust is assigned to the winner), pinned by tests.
 *
 * Pure + isomorphic: @noble hashing + the split-key primitives only.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { bytesToHex, utf8ToBytes, concatBytes } from '@noble/hashes/utils.js';
import bs58 from 'bs58';

import { scalarToBytes, bytesToScalar, verifySplitKeyClaim } from './split-key.js';
import { expectedAttempts } from './validation.js';

export const POOL_PROTOCOL = 'three-grind-pool/v1';

// USDC / $THREE atomic units (both 6 decimals on the platform).
export const ATOMICS = 1_000_000;

/**
 * Economic constants — published, bounded, and shown in the UI so the market is
 * transparent. The fee funds the platform + payout gas; the winner bonus rewards
 * the decisive find; the rest flows to contributors by share.
 */
export const ECONOMICS = Object.freeze({
	platformFeeBps: 500, //  5.0% platform fee, taken on success only
	winnerBonusBps: 6000, // 60% of the post-fee pool to the finder
	minShareBits: 8, //      a share is never easier than 1-in-256
	maxShareBits: 24, //     nor harder than 1-in-16.7M (keeps share cadence sane)
	// Target number of shares a full expected grind should yield, used to pick the
	// per-bounty share difficulty so contribution accounting has useful resolution
	// without flooding the server with share submissions.
	targetSharesPerGrind: 256,
	feeBps: 500,
});

const TAG_SHARD = utf8ToBytes('three-grind-pool/shard/v1');

// ── share difficulty ──────────────────────────────────────────────────────────

/**
 * Choose the share difficulty (in leading-zero bits of sha256(address)) for a
 * bounty, so a full expected grind yields ~targetSharesPerGrind shares — enough
 * resolution to apportion fairly, few enough to not flood the network. Clamped to
 * [minShareBits, maxShareBits].
 * @param {{prefix?:string,suffix?:string,ignoreCase?:boolean}} pattern
 * @returns {number} shareBits
 */
export function shareDifficultyBits(pattern) {
	const attempts = Math.max(1, expectedAttempts(pattern?.prefix || '', pattern?.suffix || '', !!pattern?.ignoreCase));
	// shares ≈ attempts / 2^bits ⇒ bits = log2(attempts / targetShares)
	const raw = Math.floor(Math.log2(attempts / ECONOMICS.targetSharesPerGrind));
	return Math.max(ECONOMICS.minShareBits, Math.min(ECONOMICS.maxShareBits, Number.isFinite(raw) ? raw : ECONOMICS.minShareBits));
}

/** Count leading zero bits of a byte array. */
export function leadingZeroBits(bytes) {
	let bits = 0;
	for (let i = 0; i < bytes.length; i++) {
		const b = bytes[i];
		if (b === 0) {
			bits += 8;
			continue;
		}
		bits += Math.clz32(b) - 24; // clz32 of a byte counts from a 32-bit word
		break;
	}
	return bits;
}

/** Does an address clear the share target? (sha256(address) has ≥ shareBits leading zeros) */
export function meetsShareTarget(address, shareBits) {
	const h = sha256(utf8ToBytes(String(address || '')));
	return leadingZeroBits(h) >= shareBits;
}

/**
 * Verify a submitted share with NO secret: the offset must derive the claimed
 * address from P1 (anti-cheat, same point check as a win) and the address must
 * clear the share target. A valid share proves ~2^shareBits real attempts on this
 * bounty's P1.
 * @param {object} p
 * @param {string} p.p1
 * @param {Uint8Array|string} p.offset
 * @param {string} p.address
 * @param {number} p.shareBits
 * @returns {{ ok:boolean, reason:string }}
 */
export function verifyShare({ p1, offset, address, shareBits }) {
	const d = verifySplitKeyClaim({ p1, offset, address });
	if (!d.derivationOk) return { ok: false, reason: d.reason || 'offset does not derive the claimed address' };
	if (!meetsShareTarget(address, shareBits)) return { ok: false, reason: `address does not clear the share target (${shareBits} bits)` };
	return { ok: true, reason: '' };
}

/** Weight (expected attempts) one share represents at a given difficulty. */
export function shareWeight(shareBits) {
	return Math.pow(2, shareBits);
}

// ── sharding ────────────────────────────────────────────────────────────────

/**
 * Deterministic, collision-free base offset scalar for a worker's shard. Derived
 * via HMAC-SHA256 keyed on the bounty id so shards differ across bounties; the
 * worker increments from here. Returns LE 32-byte scalar hex (the `startOffset`
 * grindSplitKeyOffset accepts).
 * @param {string} bountyId
 * @param {string} workerId
 * @param {number} shardIndex
 * @returns {string} hex offset scalar
 */
export function deriveShardOffset(bountyId, workerId, shardIndex = 0) {
	const msg = concatBytes(
		TAG_SHARD,
		utf8ToBytes(`${bountyId}|${workerId}|${shardIndex >>> 0}`),
	);
	const digest = hmac(sha256, utf8ToBytes(String(bountyId || 'pool')), msg);
	// Reduce into a scalar; the LE bytes are the worker's base offset.
	return bytesToHex(scalarToBytes(bytesToScalar(digest)));
}

// ── payout math ────────────────────────────────────────────────────────────

function toBig(n) {
	if (typeof n === 'bigint') return n;
	return BigInt(String(n).split('.')[0] || '0');
}

/**
 * Split a bounty's escrow on a verified win. Conserves the escrow exactly:
 *   reward = fee + winnerBonus + Σ contributor distributions   (+ dust → winner)
 *
 * @param {object} p
 * @param {bigint|number|string} p.rewardAtomics  total escrowed reward
 * @param {string} p.winnerId                     worker id credited with the find
 * @param {Array<{workerId:string, shares:number|bigint}>} [p.contributions]  validated shares per worker
 * @param {number} [p.feeBps=ECONOMICS.platformFeeBps]
 * @param {number} [p.winnerBonusBps=ECONOMICS.winnerBonusBps]
 * @returns {{ feeAtomics:bigint, winnerId:string, winnerAtomics:bigint,
 *   distributions:Array<{workerId:string, atomics:bigint, shares:bigint}>, totalPaid:bigint }}
 */
export function computePayouts({
	rewardAtomics,
	winnerId,
	contributions = [],
	feeBps = ECONOMICS.platformFeeBps,
	winnerBonusBps = ECONOMICS.winnerBonusBps,
}) {
	const reward = toBig(rewardAtomics);
	if (reward <= 0n) throw new Error('computePayouts: rewardAtomics must be > 0');
	if (!winnerId) throw new Error('computePayouts: winnerId required');

	const fee = (reward * BigInt(feeBps)) / 10_000n;
	const net = reward - fee;
	const winnerBonus = (net * BigInt(winnerBonusBps)) / 10_000n;
	const sharePool = net - winnerBonus;

	// Aggregate shares per worker (a worker may appear once; sum defensively).
	const byWorker = new Map();
	let totalShares = 0n;
	for (const c of contributions) {
		const s = toBig(c.shares);
		if (s <= 0n) continue;
		byWorker.set(c.workerId, (byWorker.get(c.workerId) || 0n) + s);
		totalShares += s;
	}

	const distributions = [];
	let distributed = 0n;
	if (totalShares > 0n && sharePool > 0n) {
		for (const [workerId, shares] of byWorker) {
			const atomics = (sharePool * shares) / totalShares; // floor
			if (atomics > 0n) {
				distributions.push({ workerId, atomics, shares });
				distributed += atomics;
			} else {
				distributions.push({ workerId, atomics: 0n, shares });
			}
		}
	}

	// Winner gets the bonus + any undistributed remainder (dust + the whole pool
	// when there were no shares at all). This conserves the escrow to the last unit.
	const winnerAtomics = winnerBonus + (sharePool - distributed);
	const totalPaid = fee + winnerAtomics + distributed;
	if (totalPaid !== reward) {
		throw new Error(`computePayouts: conservation violated (${totalPaid} ≠ ${reward})`);
	}
	return { feeAtomics: fee, winnerId, winnerAtomics, distributions, totalPaid };
}

/**
 * Honest difficulty → suggested reward, anchored to expected compute. Returns USDC
 * atomic units. Mirrors the bounty-protocol oracle's intent but lives here so the
 * pool board, post form, and worker estimates share one source.
 * @param {{prefix?:string,suffix?:string,ignoreCase?:boolean}} pattern
 * @returns {{ expectedAttempts:number, floorAtomics:number, suggestedAtomics:number, generousAtomics:number, expectedGrindSeconds:number }}
 */
export function suggestRewardAtomics(pattern) {
	const attempts = expectedAttempts(pattern?.prefix || '', pattern?.suffix || '', !!pattern?.ignoreCase);
	const refRatePerSec = 1_500_000; // reference fleet throughput (intuition only)
	const usdcPerGrindHour = 1 * ATOMICS;
	const floorAtomics = 50_000; // $0.05
	const maxAtomics = 5_000 * ATOMICS;
	const grindSeconds = attempts / refRatePerSec;
	const fair = (grindSeconds / 3600) * usdcPerGrindHour;
	const suggested = Math.max(floorAtomics, Math.min(maxAtomics, Math.round(fair)));
	return {
		expectedAttempts: Math.round(attempts),
		floorAtomics,
		suggestedAtomics: suggested,
		generousAtomics: Math.min(maxAtomics, Math.round(suggested * 2.5)),
		expectedGrindSeconds: Math.round(grindSeconds),
	};
}

/** Validate a reward amount is in the legal band; throws 400-tagged otherwise. */
export function validateRewardAtomics(atomics) {
	const v = Math.round(Number(atomics));
	const floor = 50_000;
	const max = 5_000 * ATOMICS;
	if (!Number.isFinite(v) || v < floor) {
		throw Object.assign(new Error(`reward must be at least ${floor} atomic units ($${(floor / ATOMICS).toFixed(2)})`), { status: 400, code: 'amount_too_low' });
	}
	if (v > max) {
		throw Object.assign(new Error(`reward exceeds the ${max}-atomic ceiling`), { status: 400, code: 'amount_too_high' });
	}
	return v;
}

/** Base58 sanity for an address (used at API boundaries). */
export function isBase58Address(s) {
	return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(s || ''));
}

/** Stable hex id for a contribution share (idempotency anchor). */
export function shareId({ bountyId, address }) {
	return bytesToHex(sha256(utf8ToBytes(`${bountyId}|${address}`))).slice(0, 32);
}

export { bs58 };
