// In-process cache for API key rows, with revocation that takes effect at once.
//
// authenticateBearer used to hit Postgres twice on every keyed call (one select,
// one last_used_at update). The row a key resolves to changes rarely, so it is
// cached here for a short window and the last_used_at write is throttled to one
// per minute per key. The cost of a cache is a stale row after a revoke, and a
// revoked key that keeps working for thirty seconds is exactly the failure a
// revoke exists to prevent. Three things close that window:
//
//   1. The revoking request evicts the row from this instance's cache, so the
//      very next call on this instance reads the database and sees revoked_at.
//   2. The revoke is also written to a shared Redis sorted set of recent
//      revocations. Every other instance reads that set at most once a second
//      (one Redis command per second per instance, however busy it is) and
//      refuses any cached key named in it. Cross-instance propagation is
//      therefore bounded by that one-second refresh, not by the cache TTL.
//   3. Without Redis there is one instance, and step 1 already covers it.
//
// A test can call resetApiKeyCache() between cases.

import { createCache } from './mem-cache.js';
import { getRedis } from './redis.js';

export const API_KEY_CACHE_TTL_MS = 30_000;
const LAST_USED_THROTTLE_MS = 60_000;
const REVOCATION_SET = 'apikey:revoked';
const REVOCATION_WINDOW_MS = API_KEY_CACHE_TTL_MS * 3;
const REVOCATION_REFRESH_MS = 1_000;

let rows = createCache({ max: 5_000, ttlMs: API_KEY_CACHE_TTL_MS });
let hashById = new Map();
let lastUsedAt = new Map();
let revokedIds = new Set();
let revokedFetchedAt = 0;
let revokedInflight = null;

/** The cached row for a token hash: a row, null for a known miss, undefined when unknown. */
export function getCachedKeyRow(hash) {
	return rows.get(hash);
}

export function rememberKeyRow(hash, row) {
	rows.set(hash, row ?? null);
	if (row?.id) hashById.set(row.id, hash);
}

/**
 * Forget a key everywhere: this instance now, every other instance within a
 * second. Called by every revoke path and by rotation.
 */
export async function invalidateApiKey(id) {
	const hash = hashById.get(id);
	if (hash) rows.delete(hash);
	hashById.delete(id);
	lastUsedAt.delete(id);
	revokedIds.add(id);
	const redis = getRedis();
	if (!redis) return;
	const now = Date.now();
	try {
		await redis.zadd(REVOCATION_SET, { score: now, member: id });
		await redis.zremrangebyscore(REVOCATION_SET, 0, now - REVOCATION_WINDOW_MS);
	} catch (err) {
		console.warn('[api-key-cache] revocation broadcast failed:', err?.message);
	}
}

async function refreshRevocations() {
	const redis = getRedis();
	if (!redis) return;
	if (revokedInflight) return revokedInflight;
	revokedInflight = (async () => {
		try {
			const since = Date.now() - REVOCATION_WINDOW_MS;
			const ids = await redis.zrange(REVOCATION_SET, since, '+inf', { byScore: true });
			const next = new Set(revokedIds);
			for (const id of ids || []) next.add(String(id));
			revokedIds = next;
		} catch (err) {
			console.warn('[api-key-cache] revocation refresh failed:', err?.message);
		} finally {
			revokedFetchedAt = Date.now();
			revokedInflight = null;
		}
	})();
	return revokedInflight;
}

/**
 * True when this key was revoked since its row was cached, on this instance or
 * on another one. Cheap: the shared set is re-read at most once a second.
 */
export async function keyRevokedSinceCached(id) {
	if (revokedIds.has(id)) return true;
	if (Date.now() - revokedFetchedAt > REVOCATION_REFRESH_MS) await refreshRevocations();
	return revokedIds.has(id);
}

/** True when last_used_at should be written for this key now (once a minute). */
export function shouldTouchLastUsed(id, now = Date.now()) {
	const last = lastUsedAt.get(id) || 0;
	if (now - last < LAST_USED_THROTTLE_MS) return false;
	lastUsedAt.set(id, now);
	return true;
}

export function resetApiKeyCache() {
	rows = createCache({ max: 5_000, ttlMs: API_KEY_CACHE_TTL_MS });
	hashById = new Map();
	lastUsedAt = new Map();
	revokedIds = new Set();
	revokedFetchedAt = 0;
	revokedInflight = null;
}
