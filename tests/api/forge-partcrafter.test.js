// PartCrafter "editable parts" lane: registration, env-gated config, opt-in
// routing (never a default or a failover target, same posture as AniGen and
// Pixal3D), the catalog's `editableParts` discoverability flag, and the gcp
// provider's `partcrafter` mode wire contract (images + num_parts in,
// parts/part_count/manifest_url surfaced out so Restyle Studio's part picker
// reads the result without a second fetch).

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

const VARS = ['MODEL_PARTCRAFTER_URL', 'MODEL_TRELLIS2_URL', 'MODEL_TRELLIS_URL', 'GCP_RECONSTRUCTION_KEY'];
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

describe('forge-tiers: PartCrafter backend registration', () => {
	it('registers a free, platform-keyed, single-image backend that accepts user photos and reports editableParts:true', () => {
		const b = BACKENDS.partcrafter;
		expect(b).toBeTruthy();
		expect(b.provider).toBe('gcp');
		expect(b.byok).toBe(false);
		expect(b.paths).toEqual(['image']);
		expect(b.requiresEnv).toEqual(['MODEL_PARTCRAFTER_URL', 'GCP_RECONSTRUCTION_KEY']);
		expect(b.free).toBe(true);
		expect(b.userImages).toBe(true);
		expect(b.editableParts).toBe(true);
		expect(b.minParts).toBe(2);
		expect(b.credits).toBeNull();
	});

	it('is configured only when BOTH the worker URL and the shared key are present', () => {
		expect(backendIsConfigured('partcrafter')).toBe(false);
		process.env.MODEL_PARTCRAFTER_URL = 'https://partcrafter.example.run.app';
		expect(backendIsConfigured('partcrafter')).toBe(false); // key still missing
		process.env.GCP_RECONSTRUCTION_KEY = 'secret';
		expect(backendIsConfigured('partcrafter')).toBe(true);
	});

	it('surfaces in the catalog with the editable-parts discoverability flag set', () => {
		process.env.MODEL_PARTCRAFTER_URL = 'https://partcrafter.example.run.app';
		process.env.GCP_RECONSTRUCTION_KEY = 'secret';
		const b = buildCatalog().backends.find((x) => x.id === 'partcrafter');
		expect(b).toBeTruthy();
		expect(b.free).toBe(true);
		expect(b.user_images).toBe(true);
		expect(b.configured).toBe(true);
		expect(b.editable_parts).toBe(true);
	});

	it('every OTHER backend reports editable_parts:false in the catalog', () => {
		const backends = buildCatalog().backends.filter((x) => x.id !== 'partcrafter');
		expect(backends.length).toBeGreaterThan(0);
		for (const b of backends) expect(b.editable_parts).toBe(false);
	});

	it('is a self-host image lane, but never a named default or a failover target', () => {
		process.env.MODEL_PARTCRAFTER_URL = 'https://partcrafter.example.run.app';
		process.env.MODEL_TRELLIS2_URL = 'https://trellis2.example.run.app';
		process.env.GCP_RECONSTRUCTION_KEY = 'secret';
		expect(isSelfHostImageLane('partcrafter')).toBe(true);
		expect(Object.values(FREE_DEFAULT_FOR_TIERS).some((v) => v.image === 'partcrafter')).toBe(false);
		expect(FREE_FALLBACK_FOR_PATH.image).not.toContain('partcrafter');
		expect(resolveBackendId({ path: 'image', tier: 'standard', userImages: true, country: 'US' })).not.toBe(
			'partcrafter',
		);
		// A down PartCrafter worker must never silently deliver an undivided
		// mesh from another lane under the "editable parts" label.
		expect(nextSelfHostImageLane('trellis2')).not.toBe('partcrafter');
		expect(nextSelfHostImageLane('partcrafter')).toBeNull();
		expect(selfHostLaneName('partcrafter')).toBe('PartCrafter');
	});

	it('stays explicitly selectable even when unconfigured (the handler owns rejection)', () => {
		expect(
			resolveBackendId({ path: 'image', tier: 'standard', backend: 'partcrafter', userImages: true, country: 'US' }),
		).toBe('partcrafter');
	});
});

describe('gcp provider: partcrafter mode wire contract', () => {
	it('submits the first reference image plus num_parts and seed', async () => {
		process.env.MODEL_PARTCRAFTER_URL = 'https://partcrafter.example.run.app';
		process.env.GCP_RECONSTRUCTION_KEY = 'secret';
		let sent = null;
		globalThis.fetch = vi.fn(async (url, opts) => {
			expect(url).toBe('https://partcrafter.example.run.app/infer');
			sent = JSON.parse(opts.body);
			expect(opts.headers.authorization).toBe('Bearer secret');
			return new Response(JSON.stringify({ task_id: 'task-partcrafter', status: 'queued' }), {
				status: 202,
				headers: { 'content-type': 'application/json' },
			});
		});

		const provider = createRegenProvider();
		const images = ['https://three.ws/cdn/front.png'];
		const submitted = await provider.submit({
			mode: 'partcrafter',
			sourceUrl: images[0],
			params: { images, num_parts: 6, seed: 3 },
		});

		expect(sent).toEqual({ images, num_parts: 6, seed: 3 });
		expect(submitted.extJobId).toBeTruthy();
	});

	it('defaults num_parts to 4 when the caller omits it', async () => {
		process.env.MODEL_PARTCRAFTER_URL = 'https://partcrafter.example.run.app';
		process.env.GCP_RECONSTRUCTION_KEY = 'secret';
		let sent = null;
		globalThis.fetch = vi.fn(async (url, opts) => {
			sent = JSON.parse(opts.body);
			return new Response(JSON.stringify({ task_id: 'task-partcrafter', status: 'queued' }), {
				status: 202,
				headers: { 'content-type': 'application/json' },
			});
		});

		const provider = createRegenProvider();
		await provider.submit({
			mode: 'partcrafter',
			sourceUrl: 'https://three.ws/cdn/front.png',
			params: { images: ['https://three.ws/cdn/front.png'] },
		});

		expect(sent.num_parts).toBe(4);
	});

	it('surfaces parts/part_count/manifest_url from the finished task record', async () => {
		process.env.MODEL_PARTCRAFTER_URL = 'https://partcrafter.example.run.app';
		process.env.GCP_RECONSTRUCTION_KEY = 'secret';
		const parts = [
			{ id: 'part_01', name: 'part_01', face_count: 1200 },
			{ id: 'part_02', name: 'part_02', face_count: 980 },
			{ id: 'part_03', name: 'part_03', face_count: 760 },
		];
		globalThis.fetch = vi.fn(async (url) => {
			if (String(url).endsWith('/infer')) {
				return new Response(JSON.stringify({ task_id: 'task-partcrafter', status: 'queued' }), {
					status: 202,
					headers: { 'content-type': 'application/json' },
				});
			}
			return new Response(
				JSON.stringify({
					status: 'done',
					result_gcs_url: 'https://cdn.example/parts.glb',
					manifest_url: 'https://cdn.example/parts.manifest.json',
					parts,
					part_count: parts.length,
				}),
				{ status: 200, headers: { 'content-type': 'application/json' } },
			);
		});

		const provider = createRegenProvider();
		const submitted = await provider.submit({
			mode: 'partcrafter',
			sourceUrl: 'https://three.ws/cdn/front.png',
			params: { images: ['https://three.ws/cdn/front.png'] },
		});
		const result = await provider.status(submitted.extJobId);

		expect(result.status).toBe('done');
		expect(result.resultGlbUrl).toBe('https://cdn.example/parts.glb');
		expect(result.manifestUrl).toBe('https://cdn.example/parts.manifest.json');
		expect(result.parts).toEqual(parts);
		expect(result.partCount).toBe(3);
	});

	it('a non-parts backend (trellis2) does not report parts/partCount', async () => {
		process.env.MODEL_TRELLIS2_URL = 'https://trellis2.example.run.app';
		process.env.GCP_RECONSTRUCTION_KEY = 'secret';
		globalThis.fetch = vi.fn(async (url) => {
			if (String(url).endsWith('/infer')) {
				return new Response(JSON.stringify({ task_id: 'task-t2', status: 'queued' }), {
					status: 202,
					headers: { 'content-type': 'application/json' },
				});
			}
			return new Response(JSON.stringify({ status: 'done', result_gcs_url: 'https://cdn.example/plain.glb' }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			});
		});

		const provider = createRegenProvider();
		const submitted = await provider.submit({
			mode: 'trellis2',
			sourceUrl: 'https://three.ws/cdn/front.png',
			params: { images: ['https://three.ws/cdn/front.png'] },
		});
		const result = await provider.status(submitted.extJobId);
		expect(result.parts).toBeUndefined();
		expect(result.partCount).toBeUndefined();
	});
});
