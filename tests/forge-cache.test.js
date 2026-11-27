import { describe, it, expect, beforeEach } from 'vitest';
import {
	forgeResultCacheKey,
	getCachedForgeResult,
	putCachedForgeResult,
	bindJobToCacheKey,
	cacheKeyForJob,
} from '../api/_lib/forge-cache.js';

// Minimal Upstash-shaped fake: get/set with a TTL-tolerant store. Lets the cache
// run without a live Redis so the boundary logic is exercised deterministically.
function fakeRedis() {
	const store = new Map();
	return {
		store,
		async get(k) {
			return store.has(k) ? store.get(k) : null;
		},
		async set(k, v) {
			store.set(k, v);
			return 'OK';
		},
		async del(k) {
			return store.delete(k) ? 1 : 0;
		},
	};
}

describe('forgeResultCacheKey', () => {
	it('is stable for the same inputs and order-independent of object keys', () => {
		const a = forgeResultCacheKey({ path: 'image', tier: 'standard', backend: 'trellis', prompt: 'A Red Cube' });
		const b = forgeResultCacheKey({ backend: 'trellis', prompt: 'a red cube', tier: 'standard', path: 'image' });
		expect(a).toBe(b); // prompt normalized (trim + lowercase)
		expect(a).toMatch(/^[0-9a-f]{40}$/);
	});

	it('returns null without a prompt (not cacheable)', () => {
		expect(forgeResultCacheKey({ path: 'image', tier: 'standard', backend: 'trellis', prompt: '' })).toBeNull();
		expect(forgeResultCacheKey({ prompt: '   ' })).toBeNull();
	});

	it('changes when an output-affecting option changes', () => {
		const base = { path: 'image', tier: 'standard', backend: 'trellis', prompt: 'a vase' };
		const k0 = forgeResultCacheKey(base);
		const kSeed = forgeResultCacheKey({ ...base, options: { seed: 7, outputFormat: 'glb' } });
		const kFmt = forgeResultCacheKey({ ...base, options: { outputFormat: 'glb-draco' } });
		const kTex = forgeResultCacheKey({ ...base, options: { textureSize: 2048, outputFormat: 'glb' } });
		expect(new Set([k0, kSeed, kFmt, kTex]).size).toBe(4);
	});

	it('an all-default options object keys identically to no options (no invalidation)', () => {
		const base = { path: 'image', tier: 'standard', backend: 'trellis', prompt: 'a vase' };
		const noOpts = forgeResultCacheKey(base);
		const defaultOpts = forgeResultCacheKey({
			...base,
			options: { seed: null, outputFormat: 'glb', textureSize: null, targetPolycount: null },
		});
		expect(noOpts).toBe(defaultOpts);
	});

	it('different tier or backend keys differently', () => {
		const p = 'a vase';
		expect(forgeResultCacheKey({ path: 'image', tier: 'standard', backend: 'trellis', prompt: p })).not.toBe(
			forgeResultCacheKey({ path: 'image', tier: 'high', backend: 'trellis', prompt: p }),
		);
	});
});

describe('forge result cache get/put round-trip', () => {
	let redis;
	beforeEach(() => {
		redis = fakeRedis();
	});

	it('stores and retrieves a completed result', async () => {
		const key = forgeResultCacheKey({ path: 'image', tier: 'standard', backend: 'trellis', prompt: 'a vase' });
		expect(await getCachedForgeResult(key, { redis })).toBeNull(); // miss first

		const ok = await putCachedForgeResult(
			key,
			{ glb_url: 'https://cdn.example/forge/x.glb', creation_id: 'c1', backend: 'trellis', tier: 'standard', path: 'image', quality: { flag: 'ok', score: 0.8 } },
			{ redis },
		);
		expect(ok).toBe(true);

		const lookup = async (id) => ({ id, status: 'done', visibility: 'public', safety_status: 'clear' });
		const hit = await getCachedForgeResult(key, { redis, lookup });
		expect(hit).toBeTruthy();
		expect(hit.creation_id).toBe('c1');
		expect(hit.glb_url).toBe('https://cdn.example/forge/x.glb');
		expect(hit.quality.flag).toBe('ok');
		expect(hit.cached_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it('refuses to store a value without a public glb_url', async () => {
		const key = 'k1';
		expect(await putCachedForgeResult(key, { glb_url: '' }, { redis })).toBe(false);
		expect(await putCachedForgeResult(key, {}, { redis })).toBe(false);
		expect(redis.store.size).toBe(0);
	});

	it('treats a stored value missing glb_url as a miss', async () => {
		redis.store.set('fr:result:bad', JSON.stringify({ backend: 'trellis' }));
		expect(await getCachedForgeResult('bad', { redis })).toBeNull();
	});

	it('binds a job to its cache key and resolves it back', async () => {
		const key = 'cachekey123';
		await bindJobToCacheKey('jobhandle-abc', key, { redis });
		expect(await cacheKeyForJob('jobhandle-abc', { redis })).toBe(key);
		expect(await cacheKeyForJob('unknown-job', { redis })).toBeNull();
	});
});

describe('fail-open without redis', () => {
	it('all operations no-op safely when no client is available', async () => {
		// No injected redis and (in test env) no shared Upstash → every call is a no-op.
		expect(await getCachedForgeResult('k')).toBeNull();
		expect(await putCachedForgeResult('k', { glb_url: 'https://x/y.glb' })).toBe(false);
		expect(await cacheKeyForJob('j')).toBeNull();
		await expect(bindJobToCacheKey('j', 'k')).resolves.toBeUndefined();
	});
});
