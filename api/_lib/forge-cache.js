// Content-addressed result cache for the /forge generation pipeline.
//
// This is distinct from the in-flight coalescing in forge-scale.js. Coalescing
// collapses CONCURRENT identical requests onto one live job for a ~6-minute
// window; this cache remembers a COMPLETED generation for days, so the second
// person to type "a brass steampunk teapot" next week gets the already-paid-for
// mesh back instantly instead of re-running (and re-paying for) the GPU pipeline.
//
// Privacy boundary — the cache only ever holds text→3D results derived from a
// public prompt (the same class of asset the public showcase already shares).
// The CALLER is responsible for never caching image→3D (a user's uploaded photo
// is private) or high-tier (paid/gated per caller) generations — see the call
// site in api/forge.js. The stored value carries only the public durable GLB URL
// and non-identifying provenance: no client key, no IP, nothing that could leak
// one user's private asset to another.
//
// Fail-open in every direction (mirrors forge-scale.js): without Upstash Redis,
// or on any command error, every function degrades to "miss / no-op" so a cache
// outage only costs the dedup, never correctness.

import { createHash } from 'node:crypto';
import { getRedis } from './redis.js';

const CACHE_PREFIX = 'fr:result:';
const BIND_PREFIX = 'fr:job:';

function intEnv(name, fallback) {
	const v = typeof process !== 'undefined' ? process.env?.[name] : null;
	const n = v == null || v === '' ? NaN : Number(v);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

// Default 7-day TTL. A generated mesh for a given prompt+params doesn't go stale,
// but a bounded TTL keeps the keyspace self-pruning and lets a model upgrade roll
// through naturally. Overridable per-deployment.
const RESULT_TTL_S = intEnv('FORGE_RESULT_CACHE_TTL_S', 7 * 24 * 3600);
// The job→key binding only needs to outlive a single generation's polling window.
const BIND_TTL_S = 3600;

// On by default whenever Redis is available; an operator can hard-disable it
// (e.g. during a model rollout) with FORGE_RESULT_CACHE=0 without a deploy. The
// optional `redis` lets callers (and tests) gate on an injected client rather
// than the shared one.
export function forgeResultCacheEnabled(redis) {
	const flag = typeof process !== 'undefined' ? process.env?.FORGE_RESULT_CACHE : null;
	if (flag === '0' || flag === 'false') return false;
	return Boolean(redis ?? getRedis());
}

function client(override) {
	return override || getRedis();
}

/**
 * Stable content address for a generation. Keyed on everything that changes the
 * output: path, tier, backend, the normalized prompt, and the output-affecting
 * options (seed, format, texture size, polycount). Returns null when the inputs
 * aren't cacheable (no prompt) so the caller can skip the cache cleanly.
 *
 * @param {{ path?: string, tier?: string|{id:string}, backend?: string,
 *           prompt?: string, options?: object }} input
 * @returns {string | null}
 */
export function forgeResultCacheKey({ path, tier, backend, prompt, options }) {
	const text = String(prompt || '').trim().toLowerCase();
	if (!text) return null;
	const tierId = typeof tier === 'string' ? tier : tier?.id || '';
	const opt = options || {};
	const basis = JSON.stringify([
		path || '',
		tierId,
		backend || '',
		text,
		// Only output-affecting options participate. A null seed/format/size keeps
		// the key identical to a request that never sent options, so adding the
		// options feature doesn't invalidate the cache for existing callers.
		opt.seed ?? null,
		opt.outputFormat || 'glb',
		opt.textureSize ?? null,
		opt.targetPolycount ?? null,
		...(opt.resolution ? [opt.resolution] : []),
	]);
	return createHash('sha256').update(basis).digest('hex').slice(0, 40);
}

/**
 * Look up a cached completed result. Returns the stored value
 * ({ glb_url, backend, tier, path, quality?, cached_at }) or null on miss.
 */
export async function getCachedForgeResult(key, { redis } = {}) {
	const r = client(redis);
	if (!r || !key || !forgeResultCacheEnabled(r)) return null;
	try {
		const raw = await r.get(`${CACHE_PREFIX}${key}`);
		if (!raw) return null;
		const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
		// Only a stored, public durable URL is a valid hit.
		if (!value || typeof value.glb_url !== 'string' || !value.glb_url) return null;
		return value;
	} catch {
		return null;
	}
}

/**
 * Store a completed result. `value.glb_url` must be a public durable URL. Extra
 * provenance (backend/tier/path/quality) is persisted for the cache-hit response.
 * No-op without Redis or when disabled. Returns true on a write.
 */
export async function putCachedForgeResult(key, value, { ttlS = RESULT_TTL_S, redis } = {}) {
	const r = client(redis);
	if (!r || !key || !forgeResultCacheEnabled(r)) return false;
	if (!value || typeof value.glb_url !== 'string' || !value.glb_url) return false;
	const payload = {
		glb_url: value.glb_url,
		backend: value.backend ?? null,
		tier: value.tier ?? null,
		path: value.path ?? null,
		quality: value.quality ?? null,
		cached_at: value.cached_at || new Date().toISOString().slice(0, 10),
	};
	try {
		await r.set(`${CACHE_PREFIX}${key}`, JSON.stringify(payload), { ex: ttlS });
		return true;
	} catch {
		return false;
	}
}

// Remember which cache key a just-submitted job belongs to, so the poll path —
// which sees the job handle and the durable GLB, but not the original request —
// can populate the result cache when the job finishes. Best-effort, short TTL.
export async function bindJobToCacheKey(jobHandle, key, { redis } = {}) {
	const r = client(redis);
	if (!r || !jobHandle || !key || !forgeResultCacheEnabled(r)) return;
	try {
		await r.set(`${BIND_PREFIX}${jobHandle}`, key, { ex: BIND_TTL_S });
	} catch {
		/* best-effort */
	}
}

// Resolve the cache key a job was bound to at submit time, or null.
export async function cacheKeyForJob(jobHandle, { redis } = {}) {
	const r = client(redis);
	if (!r || !jobHandle || !forgeResultCacheEnabled(r)) return null;
	try {
		const v = await r.get(`${BIND_PREFIX}${jobHandle}`);
		return typeof v === 'string' && v ? v : null;
	} catch {
		return null;
	}
}
