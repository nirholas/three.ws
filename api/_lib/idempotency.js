// The shared idempotency store: one key, one outcome, for 24 hours.
//
// Two front doors use it:
//   • HTTP  the v1 agents API (./agents-v1/http.js) replays a write that carries
//           an `Idempotency-Key` header.
//   • MCP   the free 3D studio (../_mcp-studio/jobs.js) hands a retried
//           generation the job the first call started instead of a second job.
//
// A record lives in the shared cache (Redis, with per-instance memory as its
// degraded fallback), keyed by who is calling and a hash of the key they chose,
// so the raw key never appears in a key listing and two callers who pick the
// same key never meet.

import { createHash } from 'node:crypto';
import { cacheDel, cacheGetFresh, cacheSet, cacheSetIfAbsent } from './cache.js';

export const IDEMPOTENCY_TTL_S = 24 * 60 * 60;
export const IDEMPOTENCY_KEY_MAX = 200;

export function sha256Hex(value) {
	return createHash('sha256').update(String(value)).digest('hex');
}

/**
 * The trimmed key, or null when none was sent. Throws a coded error for a key
 * longer than IDEMPOTENCY_KEY_MAX, which each front door renders its own way.
 * @param {unknown} raw
 * @returns {string|null}
 */
export function normalizeIdempotencyKey(raw) {
	if (typeof raw !== 'string') return null;
	const key = raw.trim();
	if (!key) return null;
	if (key.length > IDEMPOTENCY_KEY_MAX) {
		throw Object.assign(new Error(`idempotency key must be at most ${IDEMPOTENCY_KEY_MAX} characters`), {
			code: 'invalid_idempotency_key',
		});
	}
	return key;
}

/**
 * Where a caller's key lives. `scope` names the surface (and, for HTTP, the
 * route) so one key can mean different things on different endpoints.
 * @param {string} scope
 * @param {string} caller
 * @param {string} key
 */
export function idempotencyStoreKey(scope, caller, key) {
	return `${scope}:idem:${caller}:${sha256Hex(key)}`;
}

/** Stable digest of a request's arguments, used to refuse a key reused for a different request. */
export function fingerprint(value) {
	return sha256Hex(stableStringify(value));
}

// JSON with sorted object keys, so `{a, b}` and `{b, a}` fingerprint the same.
function stableStringify(value) {
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.keys(value)
			.filter((k) => value[k] !== undefined)
			.sort()
			.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
			.join(',')}}`;
	}
	return JSON.stringify(value ?? null);
}

/** The record stored under a key, or null. Always a fresh read: a retry is waiting for it to change. */
export async function readIdempotent(storeKey) {
	return cacheGetFresh(storeKey).catch(() => null);
}

/**
 * Claim a key with its first record in one atomic command. True when this
 * caller won the key; false when a record was already there.
 */
export async function claimIdempotent(storeKey, record, ttlSeconds = IDEMPOTENCY_TTL_S) {
	return cacheSetIfAbsent(storeKey, record, ttlSeconds);
}

/** Replace the record under a key the caller already holds. */
export async function writeIdempotent(storeKey, record, ttlSeconds = IDEMPOTENCY_TTL_S) {
	await cacheSet(storeKey, record, ttlSeconds);
}

/** Give a key back, so the next request with it runs as new. */
export async function releaseIdempotent(storeKey) {
	await cacheDel(storeKey);
}
