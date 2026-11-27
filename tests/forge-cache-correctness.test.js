/**
 * Forge cache correctness (forge-hardening order 125).
 *
 * A cache is only an optimization when it can never change an answer. Five ways
 * it can: two different requests share a key (a wrong model), a bad outcome is
 * stored (a failed or degenerate model replayed for a week), a model crosses an
 * account boundary (a private model handed to a stranger), a removed model keeps
 * being served, or the store going down breaks generation. Each has a section.
 *
 * The cache and the database are both faked at their boundary, so the real key,
 * read, write and validation code runs.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../api/_lib/redis.js', () => ({ getRedis: () => null }));

const { normalizeForgeOptions } = await import('../api/_lib/forge-options.js');
const cacheMod = await import('../api/_lib/forge-cache.js');
const { forgeResultCacheKey, getCachedForgeResult, putCachedForgeResult } = cacheMod;
const { forgeRequestHash } = await import('../api/_lib/forge-scale.js');
const { readCachedCatalog, writeCachedCatalog } = await import('../src/forge-catalog-cache.js');
const { recallDoneFrame, rememberDoneFrame } = await import('../api/_lib/forge-done-cache.js');

// ---------------------------------------------------------------- fakes

function fakeRedis({ failing = false } = {}) {
	const store = new Map();
	const boom = async () => {
		throw new Error('upstash unreachable');
	};
	if (failing) return { store, get: boom, set: boom, del: boom };
	return {
		store,
		async get(k) {
			return store.has(k) ? store.get(k) : null;
		},
		async set(k, v, opts = {}) {
			if (opts.nx && store.has(k)) return null;
			store.set(k, v);
			return 'OK';
		},
		async del(k) {
			return store.delete(k) ? 1 : 0;
		},
	};
}

const A = { userId: 'user-a', clientKey: 'client-a' };
const B = { userId: 'user-b', clientKey: 'client-b' };
const ANON = { userId: null, clientKey: 'anon' };

function row(over = {}) {
	return {
		id: 'c1',
		status: 'done',
		visibility: 'public',
		safety_status: 'clear',
		user_id: A.userId,
		client_key: A.clientKey,
		...over,
	};
}

const GOOD = {
	glb_url: 'https://cdn.example/forge/c1.glb',
	creation_id: 'c1',
	backend: 'trellis_selfhost',
	tier: 'standard',
	path: 'image',
	quality: { valid: true, flag: 'ok', score: 0.8 },
};

async function seeded(over = {}, key = 'k1') {
	const redis = fakeRedis();
	expect(await putCachedForgeResult(key, { ...GOOD, ...over }, { redis })).toBe(true);
	return redis;
}

// ---------------------------------------------------------------- 2. key completeness

const BASE = Object.freeze({
	path: 'image',
	tier: 'standard',
	backend: 'trellis_selfhost',
	prompt: 'a brass teapot',
	aspectRatio: '1:1',
	scope: 'public',
});

function request(over = {}, body = {}) {
	const { errors, ...options } = normalizeForgeOptions(body);
	expect(errors).toEqual([]);
	return { ...BASE, options, ...over };
}

// Every row differs from BASE in exactly one input. Each input changes what the
// engine is asked to build, or who may be handed the result.
const ONE_INPUT_APART = [
	['path', request({ path: 'geometry' })],
	['tier', request({ tier: 'draft' })],
	['backend', request({ backend: 'hunyuan_space' })],
	['prompt', request({ prompt: 'a brass kettle' })],
	['seed', request({}, { seed: 7 })],
	['seed zero', request({}, { seed: 0 })],
	['output_format', request({}, { output_format: 'glb-draco' })],
	['texture_size', request({}, { texture_size: 2048 })],
	['target_polycount', request({}, { target_polycount: 20000 })],
	['resolution', request({}, { resolution: 512 })],
	['view_labels', request({}, { view_labels: ['front'] })],
	['fill_other_sides', request({}, { fill_other_sides: true })],
	['num_parts', request({}, { num_parts: 4 })],
	['derive_pbr off', request({}, { derive_pbr: false })],
	['lods on', request({}, { lods: true })],
	['bbox', request({}, { bbox: [1, 2, 1] })],
	['bbox other', request({}, { bbox: [1, 2, 3] })],
	['pose', request({}, { pose: 't' })],
	['sampler', request({}, { sampler: { shape_slat: { steps: 20 } } })],
	['sampler other', request({}, { sampler: { shape_slat: { steps: 21 } } })],
	['aspect_ratio', request({ aspectRatio: '16:9' })],
	['director off', request({ director: false })],
	['requester scope', request({ scope: 'user-a' })],
];

describe('result-cache key: requests that differ in one input never share an entry', () => {
	const baseKey = forgeResultCacheKey(request());
	it.each(ONE_INPUT_APART)('%s changes the key', (_name, req) => {
		expect(forgeResultCacheKey(req)).not.toBe(baseKey);
	});
	it('no two of those requests share a key either', () => {
		const keys = [baseKey, ...ONE_INPUT_APART.map(([, req]) => forgeResultCacheKey(req))];
		expect(new Set(keys).size).toBe(keys.length);
	});
});

describe('in-flight coalescing hash: same separation, so a different request is never handed another job', () => {
	const baseHash = forgeRequestHash(request());
	it.each(ONE_INPUT_APART)('%s changes the hash', (_name, req) => {
		expect(forgeRequestHash(req)).not.toBe(baseHash);
	});
	it('a different photo set is a different request', () => {
		const one = forgeRequestHash(request({ images: ['https://x/a.png'] }));
		const two = forgeRequestHash(request({ images: ['https://x/b.png'] }));
		expect(one).not.toBe(two);
	});
});

// ---------------------------------------------------------------- 3. prompt normalization

describe('prompt normalization: equivalent prompts share one entry, different ones never do', () => {
	// Decision: the key folds case, outer whitespace, runs of inner whitespace and
	// the Unicode composition form, because none of them is something a person
	// means as a different object. Punctuation, digits and word order are kept:
	// "a cat, red" and "a red cat" are different requests.
	const key = (prompt) => forgeResultCacheKey(request({ prompt }));
	it.each([
		['case', 'A Brass TEAPOT'],
		['outer whitespace', '  a brass teapot \n'],
		['inner whitespace run', 'a   brass\tteapot'],
		['newline between words', 'a brass\nteapot'],
		['decomposed accents', 'café table'],
	])('%s is folded away', (_name, variant) => {
		if (variant.includes('́')) expect(key(variant)).toBe(key('café table'));
		else expect(key(variant)).toBe(key('a brass teapot'));
	});
	it.each([
		['punctuation', 'a brass, teapot'],
		['word order', 'brass a teapot'],
		['a digit', 'a brass teapot 2'],
		['a hyphen', 'a brass-teapot'],
	])('%s is kept', (_name, variant) => {
		expect(key(variant)).not.toBe(key('a brass teapot'));
	});
	it('the coalescing hash folds the same way', () => {
		const h = (prompt) => forgeRequestHash(request({ prompt }));
		expect(h('A  Brass\tTeapot ')).toBe(h('a brass teapot'));
	});
	it('spelling out a default changes nothing', () => {
		const plain = forgeResultCacheKey({ path: 'image', tier: 'standard', backend: 'trellis_selfhost', prompt: 'a brass teapot', scope: 'public' });
		const spelled = forgeResultCacheKey(request({ director: true }, { derive_pbr: true, lods: false, fill_other_sides: false, pose: 'none' }));
		expect(spelled).toBe(plain);
	});
	it('an empty prompt is not cacheable', () => {
		expect(forgeResultCacheKey(request({ prompt: ' \n\t ' }))).toBeNull();
	});
});

// ---------------------------------------------------------------- 4. never cache a bad outcome

describe('the cache only ever stores a finished, validated model', () => {
	it.each([
		['no model url', { glb_url: '' }],
		['no creation row behind it', { creation_id: null }],
		['an inline data uri (storage outage)', { glb_url: 'data:model/gltf-binary;base64,AAAA' }],
		['a failed outcome', { status: 'failed' }],
		['a job still running', { status: 'running' }],
		['a partial result', { partial: true }],
		['an invalid glb', { quality: { valid: false, flag: 'invalid', score: 0 } }],
		['a degenerate glb', { quality: { valid: true, flag: 'degenerate', score: 0.1 } }],
		['a low-quality glb', { quality: { valid: true, flag: 'low', score: 0.2 } }],
		['a vision verdict of fail', { quality_gate: { pass: false, score: 31, qa_available: true } }],
	])('refuses %s', async (_name, over) => {
		const redis = fakeRedis();
		expect(await putCachedForgeResult('k1', { ...GOOD, ...over }, { redis })).toBe(false);
		expect(redis.store.size).toBe(0);
	});

	it('stores a model whose checks passed, or that was never scored', async () => {
		for (const over of [{}, { quality: null }, { quality_gate: { pass: true, score: 88, qa_available: true } }, { quality_gate: { pass: true, qa_available: false } }]) {
			const redis = fakeRedis();
			expect(await putCachedForgeResult('k1', { ...GOOD, ...over }, { redis })).toBe(true);
		}
	});

	it('does not serve a bad entry an older build wrote', async () => {
		const redis = fakeRedis();
		redis.store.set('fr:result:k1', JSON.stringify({ ...GOOD, quality: { valid: true, flag: 'degenerate', score: 0.1 } }));
		expect(await getCachedForgeResult('k1', { redis, viewer: A, lookup: async () => row() })).toBeNull();
	});

	it('never remembers a done frame that is not a durable copy', async () => {
		expect(await rememberDoneFrame('job-nd', { status: 'done', glb_url: 'https://p.example/tmp.glb', durable: false, creation_id: null })).toBe(false);
		expect(await recallDoneFrame('job-nd', { lookup: async () => row() })).toBeNull();
	});
});

// ---------------------------------------------------------------- 5. privacy

describe('a model is only handed to someone allowed to have it', () => {
	const serve = (viewer, over) => async () => {
		const redis = await seeded();
		return getCachedForgeResult('k1', { redis, viewer, lookup: async () => row(over) });
	};
	it('serves a public model to anyone, anonymous included', async () => {
		for (const viewer of [A, B, ANON]) expect((await serve(viewer, { visibility: 'public' })())?.glb_url).toBe(GOOD.glb_url);
	});
	it('treats a legacy row with no visibility as public', async () => {
		expect(await serve(B, { visibility: null })()).not.toBeNull();
	});
	it.each(['unlisted', 'private'])('does not hand a %s model to another account', async (visibility) => {
		expect(await serve(B, { visibility })()).toBeNull();
		expect(await serve(ANON, { visibility })()).toBeNull();
	});
	it.each(['unlisted', 'private'])('does hand a %s model back to its owner, by account or by browser', async (visibility) => {
		expect(await serve(A, { visibility })()).not.toBeNull();
		expect(await serve({ userId: null, clientKey: A.clientKey }, { visibility })()).not.toBeNull();
		expect(await serve({ userId: A.userId, clientKey: 'other-browser' }, { visibility })()).not.toBeNull();
	});
	it('the shared anonymous bucket is never an owner', async () => {
		expect(await serve(ANON, { visibility: 'unlisted', client_key: 'anon', user_id: null })()).toBeNull();
	});
	it('a stranger asking with no viewer at all gets only public models', async () => {
		const redis = await seeded();
		expect(await getCachedForgeResult('k1', { redis, lookup: async () => row({ visibility: 'unlisted' }) })).toBeNull();
	});
	it('a model made private after it was cached stops being served', async () => {
		const redis = await seeded();
		let current = row({ visibility: 'public' });
		const lookup = async () => current;
		expect(await getCachedForgeResult('k1', { redis, viewer: B, lookup })).not.toBeNull();
		current = row({ visibility: 'private' });
		expect(await getCachedForgeResult('k1', { redis, viewer: B, lookup })).toBeNull();
	});
	it('the requester is part of the key unless the request asked to be public', () => {
		expect(forgeResultCacheKey(request({ scope: A.userId }))).not.toBe(forgeResultCacheKey(request({ scope: B.userId })));
	});
});

// ---------------------------------------------------------------- 6. removal

describe('a removed model is never served from any cache', () => {
	it('the result cache misses once the creation row is gone', async () => {
		const redis = await seeded();
		let present = true;
		const lookup = async () => (present ? row() : null);
		expect(await getCachedForgeResult('k1', { redis, viewer: B, lookup })).not.toBeNull();
		present = false;
		expect(await getCachedForgeResult('k1', { redis, viewer: B, lookup })).toBeNull();
	});
	it.each([
		['blocked', { safety_status: 'blocked' }],
		['held for review', { safety_status: 'held' }],
		['not finished', { status: 'generating' }],
		['failed', { status: 'failed' }],
	])('the result cache does not serve a model that is %s, even to its owner', async (_n, over) => {
		const redis = await seeded();
		expect(await getCachedForgeResult('k1', { redis, viewer: A, lookup: async () => row(over) })).toBeNull();
	});
	it('an entry from before creation ids were stored cannot be verified, so it is a miss', async () => {
		const redis = fakeRedis();
		redis.store.set('fr:result:k1', JSON.stringify({ glb_url: GOOD.glb_url, backend: 'x', tier: 'standard', path: 'image' }));
		expect(await getCachedForgeResult('k1', { redis, viewer: A, lookup: async () => row() })).toBeNull();
	});
	it('the done-frame cache answers "removed" instead of the old model', async () => {
		const frame = { job_id: 'job-1', creation_id: 'c1', status: 'done', glb_url: GOOD.glb_url, durable: true };
		expect(await rememberDoneFrame('job-1', frame)).toBe(true);
		expect(await recallDoneFrame('job-1', { lookup: async () => row() })).toEqual(frame);
		const gone = await recallDoneFrame('job-1', { lookup: async () => null });
		expect(gone).toMatchObject({ job_id: 'job-1', status: 'failed', code: 'model_removed' });
		expect(gone.glb_url).toBeUndefined();
		const blocked = await recallDoneFrame('job-1', { lookup: async () => row({ safety_status: 'blocked' }) });
		expect(blocked).toMatchObject({ status: 'failed', code: 'model_removed' });
	});
	it('the done-frame cache keeps answering when the database cannot be asked', async () => {
		const frame = { job_id: 'job-2', creation_id: 'c1', status: 'done', glb_url: GOOD.glb_url, durable: true };
		await rememberDoneFrame('job-2', frame);
		const lookup = async () => {
			throw new Error('db down');
		};
		expect(await recallDoneFrame('job-2', { lookup })).toEqual(frame);
	});
});

// ---------------------------------------------------------------- the page-side catalog snapshot

describe('page catalog snapshot', () => {
	function memStore() {
		const m = new Map();
		return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), m };
	}
	const catalog = { backends: [{ id: 'trellis_selfhost', paths: ['image'], configured: true }], tiers: [{ id: 'standard' }] };

	it('round-trips a complete catalog', () => {
		const s = memStore();
		writeCachedCatalog(catalog, s, 1000);
		expect(readCachedCatalog(s, 2000)).toEqual(catalog);
	});
	it('refuses a snapshot with no tiers: the composer reads catalog.tiers on its first frame', () => {
		const s = memStore();
		s.setItem('forge.catalog.v1', JSON.stringify({ at: 1000, catalog: { backends: catalog.backends } }));
		expect(readCachedCatalog(s, 2000)).toBeNull();
		writeCachedCatalog({ backends: catalog.backends }, s, 1000);
		expect(readCachedCatalog(s, 2000)).toBeNull();
	});
	it('refuses a snapshot stamped in the future: it would never expire', () => {
		const s = memStore();
		s.setItem('forge.catalog.v1', JSON.stringify({ at: 9_000_000_000_000, catalog }));
		expect(readCachedCatalog(s, 2000)).toBeNull();
	});
});

// ---------------------------------------------------------------- 7. store outage

describe('a cache store outage never breaks or slows generation', () => {
	it('every cache call degrades to a miss or a no-op, and none rejects', async () => {
		const redis = fakeRedis({ failing: true });
		const key = forgeResultCacheKey(request());
		await expect(getCachedForgeResult(key, { redis, viewer: A, lookup: async () => row() })).resolves.toBeNull();
		await expect(putCachedForgeResult(key, GOOD, { redis })).resolves.toBe(false);
		await expect(cacheMod.bindJobToCacheKey('job', key, { redis })).resolves.toBeUndefined();
		await expect(cacheMod.cacheKeyForJob('job', { redis })).resolves.toBeNull();
	});
	it('a store whose client cannot even be built is a miss, not an exception', async () => {
		vi.resetModules();
		vi.doMock('../api/_lib/redis.js', () => ({
			getRedis: () => {
				throw new Error('bad upstash url');
			},
		}));
		const fresh = await import('../api/_lib/forge-cache.js');
		await expect(fresh.getCachedForgeResult('k1', { viewer: A, lookup: async () => row() })).resolves.toBeNull();
		await expect(fresh.putCachedForgeResult('k1', GOOD)).resolves.toBe(false);
		await expect(fresh.cacheKeyForJob('job')).resolves.toBeNull();
		expect(fresh.forgeResultCacheEnabled()).toBe(false);
		vi.doUnmock('../api/_lib/redis.js');
	});
	it('a database that cannot be asked means no cross-account hit, never an error', async () => {
		const redis = await seeded();
		const lookup = async () => {
			throw new Error('db down');
		};
		await expect(getCachedForgeResult('k1', { redis, viewer: B, lookup })).resolves.toBeNull();
	});
});
