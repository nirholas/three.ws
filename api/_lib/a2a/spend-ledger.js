// Mandate spend ledger — enforces an Intent Mandate's TOTAL budget across the
// many autonomous payments made under it.
//
// A mandate (mandate.js) declares the caps; this ledger tracks cumulative spend
// keyed by mandateId so the (N+1)th call can't push lifetime spend over the
// authorized maximum. The check-and-increment is atomic so concurrent calls
// under the same mandate can't both slip past the cap.
//
// Storage mirrors api/_lib/x402/idempotency-cache.js: Upstash Redis in
// production (atomic INCRBY), an in-process Map fallback for dev/CI/tests. In
// production without Redis reads and reservations are refused (fail closed):
// set UPSTASH_REDIS_REST_URL/TOKEN for cross-replica budget enforcement.
//
// Amounts are atomic units (USDC has 6 decimals). They comfortably fit in a
// JS-safe integer for any realistic mandate budget; we guard against callers
// passing values beyond Number.MAX_SAFE_INTEGER so Redis INCRBY (int64) and the
// memory path agree.

import { env } from '../env.js';
import { getRedis as _getSharedRedis } from '../redis.js';

// Read at call time so the guard follows the real environment.
const isProd = () => process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';

const redis = _getSharedRedis();
if (!redis && isProd()) {
	console.error(
		'[a2a-spend-ledger] UPSTASH_REDIS_REST_URL/TOKEN not set in production; ' +
			'mandate spend is refused (fail closed) because a per-instance memory ' +
			'ledger would multiply every mandate budget by the instance count.',
	);
}

// The in-process Map is a dev/CI convenience only. In production a missing
// Redis means the shared budget cannot be proven, so reads and reservations fail.
function assertLedgerAvailable() {
	if (!redis && isProd()) throw new Error('spend ledger unavailable');
}

const KEY_PREFIX = 'a2a:spend:';

// In-memory fallback. Map<key, { spent: number, expiresAt: number }>.
const memoryStore = new Map();

function fullKey(mandateId) {
	return `${KEY_PREFIX}${mandateId}`;
}

function asSafeInt(value, field) {
	const n = typeof value === 'bigint' ? Number(value) : Number(value);
	if (!Number.isInteger(n) || n < 0) {
		throw new Error(`${field} must be a non-negative integer atomic amount`);
	}
	if (n > Number.MAX_SAFE_INTEGER) {
		throw new Error(`${field} exceeds the maximum supported atomic amount`);
	}
	return n;
}

function memoryGet(key) {
	const slot = memoryStore.get(key);
	if (!slot) return 0;
	if (slot.expiresAt && slot.expiresAt < Date.now()) {
		memoryStore.delete(key);
		return 0;
	}
	return slot.spent;
}

function memorySet(key, spent, ttlSec) {
	const prev = memoryStore.get(key);
	memoryStore.set(key, {
		spent,
		// Preserve the original expiry across increments so a long-lived mandate's
		// window doesn't slide forward on every payment.
		expiresAt: prev?.expiresAt || (ttlSec > 0 ? Date.now() + ttlSec * 1000 : 0),
	});
}

/**
 * Current cumulative spend under a mandate, in atomic units.
 * @param {string} mandateId
 * @returns {Promise<number>}
 */
export async function spent(mandateId) {
	const key = fullKey(mandateId);
	assertLedgerAvailable();
	if (!redis) return memoryGet(key);
	try {
		const raw = await redis.get(key);
		return raw ? Number(raw) : 0;
	} catch (err) {
		console.error('[a2a-spend-ledger] get failed:', err?.message || err);
		// Fail closed: if we can't read the ledger we can't prove headroom.
		throw new Error('spend ledger unavailable');
	}
}

/**
 * Atomically reserve `amount` against a mandate's total `cap`. Returns
 * { ok: true, spent } when the reservation fits, or { ok: false, spent, cap }
 * when it would exceed the cap (no funds reserved in that case).
 *
 * `ttlSec` sets the key's expiry on first reservation so a mandate's ledger is
 * garbage-collected after the mandate itself expires.
 *
 * @param {string} mandateId
 * @param {number|bigint} amount   Atomic units to reserve.
 * @param {number|bigint} cap      Total authorized atomic units (mandate.maxAtomics).
 * @param {number} ttlSec          Seconds until the ledger key expires.
 * @returns {Promise<{ ok: boolean, spent: number, cap: number }>}
 */
export async function reserve(mandateId, amount, cap, ttlSec) {
	const amt = asSafeInt(amount, 'amount');
	const capInt = asSafeInt(cap, 'cap');
	const key = fullKey(mandateId);
	assertLedgerAvailable();

	if (!redis) {
		const current = memoryGet(key);
		if (current + amt > capInt) return { ok: false, spent: current, cap: capInt };
		memorySet(key, current + amt, ttlSec);
		return { ok: true, spent: current + amt, cap: capInt };
	}

	// Atomic increment, then roll back if it overshot. INCRBY is the only
	// primitive that's safe under concurrency; check-then-set would race.
	let total;
	try {
		total = await redis.incrby(key, amt);
	} catch (err) {
		console.error('[a2a-spend-ledger] incrby failed:', err?.message || err);
		throw new Error('spend ledger unavailable');
	}
	if (total === amt && ttlSec > 0) {
		// First write created the key — set its lifetime. Best-effort.
		try {
			await redis.expire(key, ttlSec);
		} catch {
			/* expiry is GC hygiene; the cap check below still holds */
		}
	}
	if (total > capInt) {
		try {
			await redis.decrby(key, amt);
		} catch (err) {
			console.error('[a2a-spend-ledger] rollback decrby failed:', err?.message || err);
		}
		return { ok: false, spent: total - amt, cap: capInt };
	}
	return { ok: true, spent: total, cap: capInt };
}

/**
 * Release a previously-reserved amount (e.g. the payment failed downstream).
 * Floors at zero so a double-release can't drive the ledger negative.
 *
 * @param {string} mandateId
 * @param {number|bigint} amount
 * @returns {Promise<number>} the resulting cumulative spend
 */
export async function release(mandateId, amount) {
	const amt = asSafeInt(amount, 'amount');
	const key = fullKey(mandateId);

	// Nothing was reserved anywhere shared, so there is nothing to give back.
	if (!redis && isProd()) return -1;
	if (!redis) {
		const current = memoryGet(key);
		const next = Math.max(0, current - amt);
		memorySet(key, next, 0);
		return next;
	}

	try {
		const total = await redis.decrby(key, amt);
		if (total < 0) {
			await redis.set(key, 0, { keepTtl: true });
			return 0;
		}
		return total;
	} catch (err) {
		console.error('[a2a-spend-ledger] release failed:', err?.message || err);
		// A failed release leaves budget over-reserved (conservative) — never throw
		// into the caller's failure path, which is already handling a payment error.
		return -1;
	}
}

/** Test-only hook to drop the in-memory store between tests. */
export function _resetMemoryStore() {
	memoryStore.clear();
}
