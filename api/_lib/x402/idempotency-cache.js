// Redis-backed idempotency cache for x402 payment-identifier (USE-15).
//
// Keyed by `${route}|${paymentId}`. Each entry stores the response body, a
// few essential response headers (content-type, x-payment-response, status),
// and a SHA-256 hash of the request payload that was paid for. The hash is
// what the spec calls for: same id + different payload → 409 Conflict.
//
// The store falls back to an in-process Map when Upstash isn't configured, so
// `npm test` and local dev work without Redis. In production the fallback
// only fires when X402_ALLOW_MEMORY_FALLBACK=1 is set — otherwise the module
// boot-checks and refuses to load without Upstash, preventing accidental
// silent degradation across Vercel function replicas.

import { createHash } from 'node:crypto';
import { getRedis as _getSharedRedis } from '../redis.js';

const IS_PROD = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
const ALLOW_MEMORY_FALLBACK = process.env.X402_ALLOW_MEMORY_FALLBACK === '1';

const redis = _getSharedRedis();
if (!redis && IS_PROD && !ALLOW_MEMORY_FALLBACK) {
	throw new Error(
		'[x402-idempotency] refusing to boot in production without Upstash: set ' +
			'UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN for cross-replica replay ' +
			'protection, or set X402_ALLOW_MEMORY_FALLBACK=1 to explicitly accept the ' +
			'per-instance memory fallback.',
	);
} else if (!redis && IS_PROD) {
	console.warn(
		'[x402-idempotency] UPSTASH_REDIS_REST_URL/TOKEN not set; ' +
			'X402_ALLOW_MEMORY_FALLBACK=1 — using per-instance memory fallback. ' +
			'Cross-replica replay protection requires Redis.',
	);
}

const KEY_PREFIX = 'x402:idem:';

// In-memory fallback. Map<key, { entry, expiresAt }>.
const memoryStore = new Map();

function now() {
	return Date.now();
}

function memoryGet(key) {
	const slot = memoryStore.get(key);
	if (!slot) return null;
	if (slot.expiresAt && slot.expiresAt < now()) {
		memoryStore.delete(key);
		return null;
	}
	return slot.entry;
}

function memorySet(key, entry, ttlSec) {
	memoryStore.set(key, {
		entry,
		expiresAt: ttlSec > 0 ? now() + ttlSec * 1000 : 0,
	});
}

function fullKey(route, paymentId) {
	return `${KEY_PREFIX}${route}|${paymentId}`;
}

// Stable hash of the bytes the caller paid for. The route + query string +
// JSON-stringified body is enough for our endpoints — none of them depend on
// header state. Returns null when there's nothing distinguishing to hash
// (POSTs without a body fall back to route alone).
export function hashRequestPayload({ method, url, body }) {
	const h = createHash('sha256');
	h.update(String(method || 'GET').toUpperCase());
	h.update('\n');
	h.update(String(url || ''));
	h.update('\n');
	if (body !== undefined && body !== null) {
		if (typeof body === 'string') h.update(body);
		else if (Buffer.isBuffer(body)) h.update(body);
		else h.update(JSON.stringify(body));
	}
	return h.digest('hex');
}

// Hash of the signed X-PAYMENT proof. The idempotency id is a client-chosen
// label and proves nothing on its own — binding the cache entry to this hash
// means a replay only serves the cached response to a caller presenting the
// SAME signed payment (which only the original payer can produce). A caller who
// merely learned or guessed the id, but holds a different/forged payment,
// hashes differently and is denied the cached body. Returns null when there's
// no header to hash.
//
// The hash is taken over the payment's CANONICAL identity, not the header's
// bytes. Hashing the raw string let a replay strip the base64 padding, switch
// to the URL-safe alphabet, or reflow the JSON: the decoded payment was
// identical, the hash was not, and every replay guard keyed on it (this cache,
// isPaymentSpent, claimSpentPayment) missed, so one settled payment unlocked the
// good again and again.
export function hashPaymentProof(paymentHeader) {
	if (!paymentHeader) return null;
	const canonical = canonicalPaymentIdentity(paymentHeader);
	return createHash('sha256').update(canonical ?? String(paymentHeader).trim()).digest('hex');
}

function decodeHeaderJson(header) {
	const raw = String(header).trim();
	if (raw.startsWith('{')) {
		try { return JSON.parse(raw); } catch { return null; }
	}
	const b64 = raw.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
	try {
		return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
	} catch {
		return null;
	}
}

// Sorted-key JSON, so key order and whitespace never change the identity. A
// signed Solana transaction is reduced to its bytes (hex), so re-encoding the
// inner base64 does not either.
function canonicalValue(value, key) {
	if (key === 'transaction' && typeof value === 'string') {
		const bytes = Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, ''), 'base64');
		if (bytes.length) return `tx:${bytes.toString('hex')}`;
	}
	if (Array.isArray(value)) return value.map((v) => canonicalValue(v));
	if (value && typeof value === 'object') {
		const out = {};
		for (const k of Object.keys(value).sort()) out[k] = canonicalValue(value[k], k);
		return out;
	}
	if (typeof value === 'string' && /^0x[0-9a-fA-F]+$/.test(value)) return value.toLowerCase();
	return value;
}

// The pre-canonical hash (raw header bytes). Payments recorded spent before the
// canonical hash shipped are keyed on this, so the spent check reads both until
// those rows age out.
export function legacyPaymentProofHash(paymentHeader) {
	if (!paymentHeader) return null;
	return createHash('sha256').update(String(paymentHeader)).digest('hex');
}

export function canonicalPaymentIdentity(paymentHeader) {
	const decoded = decodeHeaderJson(paymentHeader);
	const payload = decoded && typeof decoded === 'object' ? decoded.payload : null;
	if (!payload || typeof payload !== 'object') return null;
	return JSON.stringify(canonicalValue(payload));
}

// Read a cached response by route + paymentId. Returns null if the key is
// missing or expired. The returned shape is whatever `set()` was given.
export async function get(route, paymentId) {
	const key = fullKey(route, paymentId);
	if (!redis) return memoryGet(key);
	try {
		const raw = await redis.get(key);
		if (!raw) return null;
		// Upstash auto-decodes JSON when storing objects, but old keys or
		// string-encoded values still come back as strings — handle both.
		return typeof raw === 'string' ? JSON.parse(raw) : raw;
	} catch (err) {
		console.error('[idempotency-cache] get failed:', err?.message || err);
		return null;
	}
}

// Write a response into the cache. ttlSec=0 means "store with no expiration"
// — never use that in production; the env-driven default is finite. Failures
// to write are logged but never thrown — the caller has already settled the
// payment and shouldn't see a 5xx because Redis blinked.
export async function set(route, paymentId, entry, ttlSec) {
	const key = fullKey(route, paymentId);
	if (!redis) {
		memorySet(key, entry, ttlSec);
		return;
	}
	try {
		const opts = ttlSec > 0 ? { ex: ttlSec } : undefined;
		await redis.set(key, JSON.stringify(entry), opts);
	} catch (err) {
		console.error('[idempotency-cache] set failed:', err?.message || err);
	}
}

// Sentinel stored while a paid request is mid-flight (verify→handler→settle).
// A concurrent request carrying the same payment that observes this marker knows
// the original is still running and must not re-execute the paid work.
export const INFLIGHT = { __x402_inflight__: true };

// Atomically claim the slot for `key`: SET NX so exactly one concurrent request
// wins. Returns true for the winner, false if a value (in-flight marker OR a
// stored response) already exists. The TTL is a crash backstop — the winner is
// expected to overwrite (set) on success or release() on failure well before it.
export async function reserve(route, paymentId, ttlSec) {
	const key = fullKey(route, paymentId);
	const ttl = ttlSec > 0 ? ttlSec : 120;
	if (!redis) {
		// Single-process fallback: the JS event loop makes get+set atomic here.
		if (memoryGet(key) != null) return false;
		memorySet(key, INFLIGHT, ttl);
		return true;
	}
	try {
		const ok = await redis.set(key, JSON.stringify(INFLIGHT), { nx: true, ex: ttl });
		// Upstash returns 'OK' on success, null when the key already existed.
		return ok === 'OK' || ok === true;
	} catch (err) {
		// On a Redis error, fall back to the IN-PROCESS claim rather than blindly
		// allowing the request. This de-dupes the common case — a client double-
		// submit landing on the same warm instance — so a Redis outage can't turn
		// into concurrent double-execution of paid work, while still not wedging a
		// legitimate payment (a hard fail-closed would 5xx every paid call during a
		// Redis blip). Cross-instance races during the outage remain bounded by the
		// always-on proof-hash dedup.
		console.error('[idempotency-cache] reserve failed, using in-process claim:', err?.message || err);
		if (memoryGet(key) != null) return false;
		memorySet(key, INFLIGHT, ttl);
		return true;
	}
}

// Release a slot claimed by reserve() when the request failed before storing a
// real response (verify/handler/settle error). Only ever called on failure paths
// where no real entry was written, so an unconditional delete is safe and keeps a
// transient failure from locking the payer out of retrying.
export async function release(route, paymentId) {
	const key = fullKey(route, paymentId);
	if (!redis) {
		memoryStore.delete(key);
		return;
	}
	try {
		await redis.del(key);
	} catch (err) {
		console.error('[idempotency-cache] release failed:', err?.message || err);
	}
}

// True when a cached entry is the in-flight marker rather than a real response.
export function isInflight(entry) {
	return !!(entry && entry.__x402_inflight__ === true);
}

// Test-only hook to drop the in-memory store between tests.
export function _resetMemoryStore() {
	memoryStore.clear();
}
