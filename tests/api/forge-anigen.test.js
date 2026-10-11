// AniGen "rig on generate" lane: registration, env-gated config, opt-in
// routing (never a default or a failover target, same posture as Pixal3D),
// the catalog's `rigged` discoverability flag, and the gcp provider's
// `anigen` mode wire contract (request shape in, `rigged`/`joint_count`
// surfaced out).
//
// Unlike every other self-host image lane, AniGen's GLB already carries a
// skeleton and skin weights: the result needs no separate rerig call, which
// is the one behavior these tests exist to pin down.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	BACKENDS,
	resolveBackendId,
	backendIsConfigured,
	buildCatalog,
	isSelfHostImageLane,
	nextSelfHostImageLane,
	selfHostLaneName,
	FREE_DEFAULT_FOR_TIERS,
	FREE_FALLBACK_FOR_PATH,
} from '../../api/_lib/forge-tiers.js';
import { createRegenProvider } from '../../api/_providers/gcp.js';

const VARS = ['MODEL_ANIGEN_URL', 'MODEL_TRELLIS2_URL', 'MODEL_TRELLIS_URL', 'GCP_RECONSTRUCTION_KEY'];
const saved = {};
const ORIGINAL_FETCH = globalThis.fetch;

beforeEach(() => {
	for (const v of VARS) {
		saved[v] = process.env[v];
		delete process.env[v];
	}
});
afterEach(() => {
	for (const v of VARS) {
		if (saved[v] === undefined) delete process.env[v];
		else process.env[v] = saved[v];
	}
	globalThis.fetch = ORIGINAL_FETCH;
	vi.restoreAllMocks();
});

describe('forge-tiers: AniGen backend registration', () => {
	it('registers a free, platform-keyed, single-image backend that accepts user photos and reports rigged:true', () => {
		const b = BACKENDS.anigen;
		expect(b).toBeTruthy();
		expect(b.provider).toBe('gcp');
		expect(b.byok).toBe(false);
		expect(b.paths).toEqual(['image']);
		expect(b.requiresEnv).toEqual(['MODEL_ANIGEN_URL', 'GCP_RECONSTRUCTION_KEY']);
		expect(b.free).toBe(true);
		expect(b.userImages).toBe(true);
		expect(b.rigged).toBe(true);
		expect(b.credits).toBeNull();
	});

	it('is configured only when BOTH the worker URL and the shared key are present', () => {
		expect(backendIsConfigured('anigen')).toBe(false);
		process.env.MODEL_ANIGEN_URL = 'https://anigen.example.run.app';
		expect(backendIsConfigured('anigen')).toBe(false); // key still missing
		process.env.GCP_RECONSTRUCTION_KEY = 'secret';
		expect(backendIsConfigured('anigen')).toBe(true);
	});

	it('surfaces in the catalog with the rigged discoverability flag set', () => {
		process.env.MODEL_ANIGEN_URL = 'https://anigen.example.run.app';
		process.env.GCP_RECONSTRUCTION_KEY = 'secret';
		const b = buildCatalog().backends.find((x) => x.id === 'anigen');
		expect(b).toBeTruthy();
		expect(b.free).toBe(true);
		expect(b.user_images).toBe(true);
		expect(b.configured).toBe(true);
		expect(b.rigged).toBe(true);
		expect(b.max_images).toBe(1);
		expect(b.multi_view).toBe(false);
	});

	it('every OTHER backend reports rigged:false in the catalog', () => {
		const backends = buildCatalog().backends.filter((x) => x.id !== 'anigen');
		expect(backends.length).toBeGreaterThan(0);
		for (const b of backends) expect(b.rigged).toBe(false);
	});

	it('is a self-host image lane, but never a named default or a failover target', () => {
		process.env.MODEL_ANIGEN_URL = 'https://anigen.example.run.app';
		process.env.MODEL_TRELLIS2_URL = 'https://trellis2.example.run.app';
		process.env.GCP_RECONSTRUCTION_KEY = 'secret';
		expect(isSelfHostImageLane('anigen')).toBe(true);
		// Not named anywhere in the free-default or free-fallback tables.
		expect(Object.values(FREE_DEFAULT_FOR_TIERS).some((v) => v.image === 'anigen')).toBe(false);
		expect(FREE_FALLBACK_FOR_PATH.image).not.toContain('anigen');
		// A plain (no explicit backend) photo request never lands here.
		expect(resolveBackendId({ path: 'image', tier: 'standard', userImages: true, country: 'US' })).not.toBe('anigen');
		// Nothing fails over TO anigen, and anigen fails over to nothing (a down
		// AniGen worker must never silently deliver an unrigged result from
		// another lane under the "rig on generate" label).
		expect(nextSelfHostImageLane('trellis2')).not.toBe('anigen');
		expect(nextSelfHostImageLane('anigen')).toBeNull();
		expect(selfHostLaneName('anigen')).toBe('AniGen');
	});

	it('stays explicitly selectable even when unconfigured (the handler owns rejection)', () => {
		expect(
			resolveBackendId({ path: 'image', tier: 'standard', backend: 'anigen', userImages: true, country: 'US' }),
		).toBe('anigen');
	});
});

describe('gcp provider: anigen mode wire contract', () => {
	it('submits the first reference image plus seed, and the ETA/viewsUsed shape is single-view', async () => {
		process.env.MODEL_ANIGEN_URL = 'https://anigen.example.run.app';
		process.env.GCP_RECONSTRUCTION_KEY = 'secret';
		let sent = null;
		globalThis.fetch = vi.fn(async (url, opts) => {
			expect(url).toBe('https://anigen.example.run.app/infer');
			sent = JSON.parse(opts.body);
			expect(opts.headers.authorization).toBe('Bearer secret');
			return new Response(JSON.stringify({ task_id: 'task-anigen', status: 'queued' }), {
				status: 202,
				headers: { 'content-type': 'application/json' },
			});
		});

		const provider = createRegenProvider();
		const images = ['https://three.ws/cdn/front.png'];
		const submitted = await provider.submit({
			mode: 'anigen',
			sourceUrl: images[0],
			params: { images, seed: 7 },
		});

		expect(sent).toEqual({ images, seed: 7 });
		expect(submitted.viewsUsed).toBe(1);
		expect(submitted.multiview).toBe(false);
		expect(submitted.eta).toBe(90);
	});

	it('surfaces rigged:true and joint_count from the finished task record', async () => {
		process.env.MODEL_ANIGEN_URL = 'https://anigen.example.run.app';
		process.env.GCP_RECONSTRUCTION_KEY = 'secret';
		globalThis.fetch = vi.fn(async (url) => {
			if (String(url).endsWith('/infer')) {
				return new Response(JSON.stringify({ task_id: 'task-anigen', status: 'queued' }), {
					status: 202,
					headers: { 'content-type': 'application/json' },
				});
			}
			return new Response(
				JSON.stringify({
					status: 'done',
					result_gcs_url: 'https://cdn.example/rigged.glb',
					joint_count: 24,
				}),
				{ status: 200, headers: { 'content-type': 'application/json' } },
			);
		});

		const provider = createRegenProvider();
		const submitted = await provider.submit({
			mode: 'anigen',
			sourceUrl: 'https://three.ws/cdn/front.png',
			params: { images: ['https://three.ws/cdn/front.png'] },
		});
		const result = await provider.status(submitted.extJobId);

		expect(result.status).toBe('done');
		expect(result.resultGlbUrl).toBe('https://cdn.example/rigged.glb');
		expect(result.rigged).toBe(true);
		expect(result.jointCount).toBe(24);
	});

	it('a never-rigged backend (trellis2) does not report rigged/jointCount', async () => {
		process.env.MODEL_TRELLIS2_URL = 'https://trellis2.example.run.app';
		process.env.GCP_RECONSTRUCTION_KEY = 'secret';
		globalThis.fetch = vi.fn(async (url) => {
			if (String(url).endsWith('/infer')) {
				return new Response(JSON.stringify({ task_id: 'task-t2', status: 'queued' }), {
					status: 202,
					headers: { 'content-type': 'application/json' },
				});
			}
			return new Response(
				JSON.stringify({ status: 'done', result_gcs_url: 'https://cdn.example/plain.glb' }),
				{ status: 200, headers: { 'content-type': 'application/json' } },
			);
		});

		const provider = createRegenProvider();
		const submitted = await provider.submit({
			mode: 'trellis2',
			sourceUrl: 'https://three.ws/cdn/front.png',
			params: { images: ['https://three.ws/cdn/front.png'] },
		});
		const result = await provider.status(submitted.extJobId);
		expect(result.rigged).toBeUndefined();
		expect(result.jointCount).toBeUndefined();
	});
});
