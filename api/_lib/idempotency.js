// The shared idempotency store: one key, one outcome, for 24 hours.
//
// Two call shapes live here:
//   • Low-level primitives (idempotencyStoreKey, claimIdempotent,
//     writeIdempotent, readIdempotent, releaseIdempotent) for a caller that
//     needs to own the claim/release lifecycle itself: the v1 agents API
//     (./agents-v1/http.js) replays a write that carries an `Idempotency-Key`
//     header, and the free 3D studio's job queue (../_mcp-studio/jobs.js)
//     hands a retried generation the job the first call started.
//   • runOnce(), a higher-level wrapper that acquires an in-flight lock, runs
//     the work, and stores the outcome in one call: used by the domains
//     service, x402 spec and remix-asset handlers, the MCP studio's
//     generation tools, and the perps tools, so a scheduled agent that
//     retries after a timeout collects the job it already started rather than
//     burning the shared quota on a second one.
//
// A record lives in the shared cache (Redis, with per-instance memory as its
// degraded fallback), keyed by who is calling and a hash of the key they chose,
// so the raw key never appears in a key listing and two callers who pick the
// same key never meet.

import { createHash } from 'node:crypto';
import { acquireLock, cacheDel, cacheGet, cacheGetFresh, cacheSet, cacheSetIfAbsent, releaseLock } from './cache.js';

export const IDEMPOTENCY_TTL_S = 24 * 60 * 60;
export const IDEMPOTENCY_KEY_MAX = 200;

// Longer than the slowest inline generation wait (STUDIO_FORGE_TIMEOUT_MS), so a
// retry that arrives mid-run is told to wait rather than started a second time.
const LOCK_TTL_S = 300;

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

/** Normalize a caller-supplied key, or null when none was sent (runOnce's trimmed form: silently truncated rather than throwing). */
export function normalizeKey(raw) {
	if (typeof raw !== 'string') return null;
	const key = raw.trim();
	return key ? key.slice(0, IDEMPOTENCY_KEY_MAX) : null;
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

/** runOnce's argument digest: same stable-sort approach, named for its call sites. */
export function argsDigest(args) {
	return sha256Hex(stableStringify(args ?? {}));
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

function runOnceStoreKey(caller, key) {
	return `mcp:idem:${sha256Hex(caller)}:${sha256Hex(key)}`;
}

/**
 * Run `run()` at most once per (caller, key) across 24 hours.
 *
 * Outcomes:
 *   { state: 'fresh',    value }   first call: `run()` executed; `value` is its result
 *   { state: 'replayed', stored }  a finished call with this key exists; `stored` is
 *                                  what `shouldStore` kept, and `run()` did not run
 *   { state: 'conflict' }          the key was used for a different request
 *   { state: 'in_progress' }       the first call is still running
 *
 * `shouldStore(value)` decides whether an outcome is final. A failure is not: it
 * leaves the key free, so the retry the key exists for can actually retry.
 * `toStored(value)` is what is kept (default: the value itself).
 * `revalidate(stored)` lets a stored outcome that has since gone bad (a job that
 * was pending and then failed) be dropped: return the value to replay, or null
 * to forget the entry and run `run()` afresh under the same key.
 */
export async function runOnce({
	caller,
	key,
	fingerprint: fp,
	run,
	shouldStore = () => true,
	toStored = (v) => v,
	revalidate = null,
}) {
	const k = runOnceStoreKey(caller, key);
	const hit = await cacheGet(k).catch(() => null);
	if (hit) {
		if (hit.fingerprint !== fp) return { state: 'conflict' };
		const current = revalidate ? await revalidate(hit.stored) : hit.stored;
		if (current !== null) return { state: 'replayed', stored: current };
		await cacheDel(k).catch(() => {});
	}
	const lock = `${k}:lock`;
	if (!(await acquireLock(lock, LOCK_TTL_S))) return { state: 'in_progress' };
	try {
		const value = await run();
		if (shouldStore(value)) {
			await cacheSet(k, { fingerprint: fp, stored: toStored(value) }, IDEMPOTENCY_TTL_S).catch(() => {});
		}
		return { state: 'fresh', value };
	} finally {
		await releaseLock(lock);
	}
}
