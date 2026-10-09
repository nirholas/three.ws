// Idempotency for tool calls that start work: the same caller sending the same
// key within 24 hours gets the original outcome back instead of a second run.
//
// This is the store behind the agents API's `Idempotency-Key` header
// (api/_lib/agents-v1/http.js): the shared cache (Redis when configured, process
// memory otherwise), the same 24 hour window, the same in-flight lock. The MCP
// studio uses it for the optional `idempotency_key` argument on every generation
// tool, so a scheduled agent (Grok Bot) that retries after a timeout collects the
// job it already started rather than burning the shared quota on a second one.
//
// Identity: the entry is scoped to `caller`, an opaque string the transport
// derives (an install token, a connector session, or the client address), so two
// callers who pick the same key never see each other's job.

import { createHash } from 'node:crypto';
import { acquireLock, cacheDel, cacheGet, cacheSet, releaseLock } from './cache.js';

export const IDEMPOTENCY_TTL_S = 24 * 60 * 60;
export const IDEMPOTENCY_KEY_MAX = 200;

// Longer than the slowest inline generation wait (STUDIO_FORGE_TIMEOUT_MS), so a
// retry that arrives mid-run is told to wait rather than started a second time.
const LOCK_TTL_S = 300;

const digest = (value) => createHash('sha256').update(String(value)).digest('hex');

/** Normalize a caller-supplied key, or null when none was sent. */
export function normalizeKey(raw) {
	if (typeof raw !== 'string') return null;
	const key = raw.trim();
	return key ? key.slice(0, IDEMPOTENCY_KEY_MAX) : null;
}

/** Stable hash of the arguments that define "the same request". */
export function argsDigest(args) {
	const sorted = (v) =>
		Array.isArray(v)
			? v.map(sorted)
			: v && typeof v === 'object'
				? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])]))
				: v;
	return digest(JSON.stringify(sorted(args ?? {})));
}

function storeKey(caller, key) {
	return `mcp:idem:${digest(caller)}:${digest(key)}`;
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
	fingerprint,
	run,
	shouldStore = () => true,
	toStored = (v) => v,
	revalidate = null,
}) {
	const k = storeKey(caller, key);
	const hit = await cacheGet(k).catch(() => null);
	if (hit) {
		if (hit.fingerprint !== fingerprint) return { state: 'conflict' };
		const current = revalidate ? await revalidate(hit.stored) : hit.stored;
		if (current !== null) return { state: 'replayed', stored: current };
		await cacheDel(k).catch(() => {});
	}
	const lock = `${k}:lock`;
	if (!(await acquireLock(lock, LOCK_TTL_S))) return { state: 'in_progress' };
	try {
		const value = await run();
		if (shouldStore(value)) {
			await cacheSet(k, { fingerprint, stored: toStored(value) }, IDEMPOTENCY_TTL_S).catch(() => {});
		}
		return { state: 'fresh', value };
	} finally {
		await releaseLock(lock);
	}
}
