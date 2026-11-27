// Content-addressed result cache for the /forge generation pipeline.
//
// This is distinct from the in-flight coalescing in forge-scale.js. Coalescing
// collapses CONCURRENT identical requests onto one live job for a ~6-minute
// window; this cache remembers a COMPLETED generation for days, so the second
// person to type "a brass steampunk teapot" next week gets the already-paid-for
// mesh back instantly instead of re-running (and re-paying for) the GPU pipeline.
//
// What makes two requests the same is defined once, in forge-request-identity.js,
// and shared with the in-flight coalescing hash in forge-scale.js. That includes
// who may be handed the result: a request that did not ask to be public is keyed
// to its requester, so one account's unlisted model is never another account's hit.
//
// The CALLER still never caches image->3D (a user's uploaded photo is private) or
// high-tier (paid/gated per caller) generations: see the call site in api/forge.js.
//
// Correctness rules this module enforces itself, so no call site can forget them:
//   - Only a finished, durable, validated model is stored (cacheableOutcome). A
//     failure, a partial or still-running job, an inline data URI from a storage
//     outage, a GLB the geometry check flagged, or a failing vision verdict is
//     never written, and an entry an older build wrote that breaks the rule is
//     never served.
//   - Every entry carries the creation row it came from, and every read checks
//     that row (forge-cache-guard.js): a model deleted, made private, blocked by
//     the content-safety sweep or held for review stops being served the moment
//     the row says so, and the stale entry is dropped. A row that cannot be read
//     (database outage) is a miss, never a guess.
//
// Fail-open in every direction (mirrors forge-scale.js): without Upstash Redis,
// with a client that cannot be built, or on any command error, every function
// degrades to "miss / no-op" so a cache outage only costs the dedup, never
// correctness and never an error the user sees.

import { createHash } from 'node:crypto';
import { getRedis } from './redis.js';
import { normalizeStoredUrl } from './r2.js';
import { normalizePrompt, extraIdentityInputs } from './forge-request-identity.js';
import { creationLive, creationServableTo, lookupCreation } from './forge-cache-guard.js';

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
	return Boolean(redis ?? client());
}

// The store client, or null. getRedis() throws on a malformed Upstash URL; that
// is a store outage like any other, so it reads as "no cache", never an error.
function client(override) {
	if (override) return override;
	try {
		return getRedis() || null;
	} catch {
		return null;
	}
}

const QUALITY_FLAGS_REFUSED = new Set(['invalid', 'degenerate', 'low']);

/**
 * Whether a finished generation may be stored in, or served from, the cache.
 * Pure. True only for a durable model with a creation row behind it that no
 * check has failed: a model a week of strangers would be handed instantly has
 * to be one we would hand them on purpose.
 *
 * @param {object|null|undefined} value
 * @returns {boolean}
 */
export function cacheableOutcome(value) {
	if (!value || typeof value !== 'object') return false;
	// A public, durable URL only. A data: URI is what a storage outage leaves
	// behind (see _lib/image-persist.js), and a blob: or relative URL is not
	// anything a different browser can load.
	if (typeof value.glb_url !== 'string' || !/^https?:\/\//i.test(value.glb_url)) return false;
	// No creation row means nothing can later prove the model is still allowed
	// out (removal, privacy, takedown), so it is never cached.
	if (typeof value.creation_id !== 'string' || !value.creation_id) return false;
	if (value.status != null && value.status !== 'done') return false;
	if (value.partial === true) return false;
	const q = value.quality;
	if (q && typeof q === 'object') {
		if (q.valid === false) return false;
		if (QUALITY_FLAGS_REFUSED.has(q.flag)) return false;
	}
	const gate = value.quality_gate;
	// A failing vision verdict is a model the user was offered a regenerate for.
	// An unscored one (QA unavailable) is not a failure.
	if (gate && typeof gate === 'object' && gate.pass === false && gate.qa_available !== false) return false;
	return true;
}

/**
 * Stable content address for a generation. Keyed on everything that changes the
 * output, and on who may be handed it: path, tier, backend, the normalized
 * prompt (forge-request-identity.js decides what folds), the output-affecting
 * options, and the request scope. Returns null when the inputs aren't cacheable
 * (no prompt) so the caller can skip the cache cleanly.
 *
 * Every input at its default contributes nothing, and `scope: 'public'` (or no
 * scope) is the default, so a public request that never sent options keeps the
 * key it always had.
 *
 * @param {{ path?: string, tier?: string|{id:string}, backend?: string,
 *           prompt?: string, options?: object, aspectRatio?: string,
 *           director?: boolean, scope?: string }} input
 * @returns {string | null}
 */
export function forgeResultCacheKey({ path, tier, backend, prompt, options, aspectRatio, director, scope }) {
	const text = normalizePrompt(prompt);
	if (!text) return null;
	const tierId = typeof tier === 'string' ? tier : tier?.id || '';
	const opt = options || {};
	const extras = extraIdentityInputs({ options: opt, aspectRatio, director });
	const sc = typeof scope === 'string' && scope && scope !== 'public' ? scope : null;
	const basis = JSON.stringify([
		path || '',
		tierId,
		backend || '',
		text,
		opt.seed ?? null,
		opt.outputFormat || 'glb',
		opt.textureSize ?? null,
		opt.targetPolycount ?? null,
		...(opt.resolution ? [opt.resolution] : []),
		...(extras.length ? [['x', extras]] : []),
		...(sc ? [['scope', sc]] : []),
	]);
	return createHash('sha256').update(basis).digest('hex').slice(0, 40);
}

/**
 * Look up a cached completed result for `viewer`. Returns the stored value
 * ({ glb_url, creation_id, backend, tier, path, quality?, cached_at }) or null
 * on a miss. A hit is only returned when the creation row behind it says the
 * model is still finished, not blocked or held, and allowed to this viewer
 * (`viewer: null` asks the public question). An entry that fails that check is
 * deleted so the next identical request generates fresh.
 *
 * @param {string|null} key
 * @param {{ redis?: object, viewer?: { userId?: string|null, clientKey?: string|null }|null,
 *           lookup?: (id: string) => Promise<object|null> }} [opts]
 */
export async function getCachedForgeResult(key, { redis, viewer = null, lookup = lookupCreation } = {}) {
	const r = client(redis);
	if (!r || !key || !forgeResultCacheEnabled(r)) return null;
	let value;
	try {
		const raw = await r.get(`${CACHE_PREFIX}${key}`);
		if (!raw) return null;
		value = typeof raw === 'string' ? JSON.parse(raw) : raw;
	} catch {
		return null;
	}
	if (!cacheableOutcome(value)) {
		await dropEntry(r, key);
		return null;
	}
	let row;
	try {
		row = await lookup(value.creation_id);
	} catch {
		// The row cannot be read (database outage). A cross-account cache never
		// guesses: miss, generate fresh, and keep the entry for when it can be read.
		return null;
	}
	if (!creationLive(row)) {
		// Deleted, unfinished, blocked by the safety sweep or a takedown, or held
		// for review: removed for everyone, so the entry goes too.
		await dropEntry(r, key);
		return null;
	}
	// Live but not this viewer's to have (unlisted or private and not theirs, or
	// a public request still waiting for the safety sweep to promote it): a miss
	// for this viewer only. The entry stays for the people allowed to have it.
	if (!creationServableTo(row, viewer)) return null;
	// Entries written before providers switched to /cdn/ carry the raw public
	// bucket domain, which now 404s; replay them in the /cdn/ form.
	return { ...value, glb_url: cdnFormOf(value.glb_url) };
}

async function dropEntry(r, key) {
	try {
		if (typeof r.del === 'function') await r.del(`${CACHE_PREFIX}${key}`);
	} catch {
		/* best-effort: every read re-checks anyway */
	}
}

// normalizeStoredUrl() reads S3_PUBLIC_DOMAIN, which throws when object
// storage is not configured; a URL that cannot be mapped is returned as stored.
function cdnFormOf(url) {
	try {
		return normalizeStoredUrl(url);
	} catch {
		return url;
	}
}

/**
 * Store a completed result. Refused unless cacheableOutcome() holds: a durable
 * public URL, the creation row it belongs to, and no failed check. Extra
 * provenance (backend/tier/path/quality) is persisted for the cache-hit
 * response. No-op without Redis or when disabled. Returns true on a write.
 */
export async function putCachedForgeResult(key, value, { ttlS = RESULT_TTL_S, redis } = {}) {
	const r = client(redis);
	if (!r || !key || !forgeResultCacheEnabled(r)) return false;
	if (!cacheableOutcome(value)) return false;
	const payload = {
		glb_url: value.glb_url,
		creation_id: value.creation_id,
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
