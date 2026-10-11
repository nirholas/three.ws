// Pixal3D "Match my photo" lane: registration, env-gated config, opt-in
// routing (never a default or a failover target), the forge.js request
// boundary (1-4 images, view_labels, fill_other_sides), and the gcp
// provider's `pixal3d` mode wire contract.
//
// Unlike every other self-host image lane (trellis2, trellis_selfhost, the
// Modly pair), Pixal3D actually fuses every reference view it is given
// instead of reading the first one alone, that is the whole point of this
// lane, and the one behavior these tests exist to pin down.

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
	PIXAL3D_RESOLUTIONS,
	PIXAL3D_VIEW_LABELS,
} from '../../api/_lib/forge-tiers.js';
import { normalizeForgeOptions } from '../../api/_lib/forge-options.js';
import { createRegenProvider } from '../../api/_providers/gcp.js';

const VARS = ['MODEL_PIXAL3D_URL', 'MODEL_TRELLIS2_URL', 'MODEL_TRELLIS_URL', 'GCP_RECONSTRUCTION_KEY'];
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

describe('forge-tiers: Pixal3D backend registration', () => {
	it('registers a free, platform-keyed, multi-image backend that accepts user photos', () => {
		const b = BACKENDS.pixal3d;
		expect(b).toBeTruthy();
		expect(b.provider).toBe('gcp');
		expect(b.byok).toBe(false);
		expect(b.paths).toEqual(['image']);
		expect(b.requiresEnv).toEqual(['MODEL_PIXAL3D_URL', 'GCP_RECONSTRUCTION_KEY']);
		expect(b.free).toBe(true);
		expect(b.userImages).toBe(true);
		expect(b.maxImages).toBe(4);
		expect(b.multiView).toBe(true);
		expect(b.fillOtherSides).toBe(true);
		expect(b.credits).toBeNull();
	});

	it('is configured only when BOTH the worker URL and the shared key are present', () => {
		expect(backendIsConfigured('pixal3d')).toBe(false);
		process.env.MODEL_PIXAL3D_URL = 'https://pixal3d.example.run.app';
		expect(backendIsConfigured('pixal3d')).toBe(false); // key still missing
		process.env.GCP_RECONSTRUCTION_KEY = 'secret';
		expect(backendIsConfigured('pixal3d')).toBe(true);
	});

	it('surfaces in the catalog with its resolutions, max image count and view labels', () => {
		process.env.MODEL_PIXAL3D_URL = 'https://pixal3d.example.run.app';
		process.env.GCP_RECONSTRUCTION_KEY = 'secret';
		const b = buildCatalog().backends.find((x) => x.id === 'pixal3d');
		expect(b).toBeTruthy();
		expect(b.free).toBe(true);
		expect(b.user_images).toBe(true);
		expect(b.configured).toBe(true);
		expect(b.resolutions).toEqual(PIXAL3D_RESOLUTIONS);
		expect(b.max_images).toBe(4);
		expect(b.multi_view).toBe(true);
		expect(b.view_labels).toEqual(PIXAL3D_VIEW_LABELS);
		expect(b.fill_other_sides).toBe(true);
	});

	it('is a self-host image lane, but never a named default or a failover target', () => {
		process.env.MODEL_PIXAL3D_URL = 'https://pixal3d.example.run.app';
		process.env.MODEL_TRELLIS2_URL = 'https://trellis2.example.run.app';
		process.env.GCP_RECONSTRUCTION_KEY = 'secret';
		expect(isSelfHostImageLane('pixal3d')).toBe(true);
		// Not named anywhere in the free-default or free-fallback tables.
		expect(Object.values(FREE_DEFAULT_FOR_TIERS).some((v) => v.image === 'pixal3d')).toBe(false);
		expect(FREE_FALLBACK_FOR_PATH.image).not.toContain('pixal3d');
		// A plain (no explicit backend) photo request never lands here.
		expect(resolveBackendId({ path: 'image', tier: 'standard', userImages: true, country: 'US' })).not.toBe('pixal3d');
		// Nothing fails over TO pixal3d, and pixal3d fails over to nothing (a
		// down Pixal3D must never silently drop the caller's 2nd/3rd photo on a
		// lane that only reads the first view).
		expect(nextSelfHostImageLane('trellis2')).not.toBe('pixal3d');
		expect(nextSelfHostImageLane('pixal3d')).toBeNull();
		expect(selfHostLaneName('pixal3d')).toBe('Pixal3D');
	});

	it('stays explicitly selectable even when unconfigured (the handler owns rejection)', () => {
		expect(
			resolveBackendId({ path: 'image', tier: 'standard', backend: 'pixal3d', userImages: true, country: 'US' }),
		).toBe('pixal3d');
	});
});

describe('forge-options: Pixal3D view_labels / fill_other_sides', () => {
	it('accepts the documented resolutions', () => {
		for (const r of PIXAL3D_RESOLUTIONS) {
			expect(normalizeForgeOptions({ resolution: r }).errors).toEqual([]);
		}
	});

	it('round-trips a per-image view_labels array', () => {
		const o = normalizeForgeOptions({ view_labels: ['front', 'right', 'back'] });
		expect(o.viewLabels).toEqual(['front', 'right', 'back']);
	});
});

describe('gcp provider: pixal3d mode wire contract', () => {
	it('forwards every reference image, not just the first, plus view_labels', async () => {
		process.env.MODEL_PIXAL3D_URL = 'https://pixal3d.example.run.app';
		process.env.GCP_RECONSTRUCTION_KEY = 'secret';
		let sent = null;
		globalThis.fetch = vi.fn(async (url, opts) => {
			expect(url).toBe('https://pixal3d.example.run.app/infer');
			sent = JSON.parse(opts.body);
			expect(opts.headers.authorization).toBe('Bearer secret');
			return new Response(JSON.stringify({ task_id: 'task-p3d', status: 'queued' }), {
				status: 202,
				headers: { 'content-type': 'application/json' },
			});
		});

		const provider = createRegenProvider();
		const images = [
			'https://three.ws/cdn/front.png',
			'https://three.ws/cdn/back.png',
			'https://three.ws/cdn/left.png',
		];
		const submitted = await provider.submit({
			mode: 'pixal3d',
			sourceUrl: images[0],
			params: {
				images,
				view_labels: ['front', 'back', 'left'],
				resolution: 1536,
				tier: 'high',
				seed: 42,
			},
		});

		expect(sent.images).toEqual(images);
		expect(sent.view_labels).toEqual(['front', 'back', 'left']);
		expect(sent.resolution).toBe(1536);
		expect(sent.tier).toBe('high');
		expect(sent.seed).toBe(42);
		// Unlike trellis2/hunyuan/modly (which hardcode viewsUsed:1), Pixal3D
		// genuinely fuses every view, the DoD line this test pins down.
		expect(submitted.viewsUsed).toBe(3);
		expect(submitted.multiview).toBe(true);
	});

	it('forwards fill_other_sides only when the caller opts in', async () => {
		process.env.MODEL_PIXAL3D_URL = 'https://pixal3d.example.run.app';
		process.env.GCP_RECONSTRUCTION_KEY = 'secret';
		const bodies = [];
		globalThis.fetch = vi.fn(async (_url, opts) => {
			bodies.push(JSON.parse(opts.body));
			return new Response(JSON.stringify({ task_id: 'task-fos', status: 'queued' }), {
				status: 202,
				headers: { 'content-type': 'application/json' },
			});
		});
		const provider = createRegenProvider();
		await provider.submit({
			mode: 'pixal3d',
			sourceUrl: 'https://three.ws/cdn/photo.png',
			params: { images: ['https://three.ws/cdn/photo.png'], fill_other_sides: true },
		});
		await provider.submit({
			mode: 'pixal3d',
			sourceUrl: 'https://three.ws/cdn/photo.png',
			params: { images: ['https://three.ws/cdn/photo.png'] },
		});
		expect(bodies[0].fill_other_sides).toBe(true);
		expect(bodies[1]).not.toHaveProperty('fill_other_sides');
	});

	it('single-image request stays the same minimal shape as trellis2 (no view_labels/fill_other_sides noise)', async () => {
		process.env.MODEL_PIXAL3D_URL = 'https://pixal3d.example.run.app';
		process.env.GCP_RECONSTRUCTION_KEY = 'secret';
		let sent = null;
		globalThis.fetch = vi.fn(async (_url, opts) => {
			sent = JSON.parse(opts.body);
			return new Response(JSON.stringify({ task_id: 'task-single', status: 'queued' }), {
				status: 202,
				headers: { 'content-type': 'application/json' },
			});
		});
		const provider = createRegenProvider();
		const submitted = await provider.submit({
			mode: 'pixal3d',
			sourceUrl: 'https://three.ws/cdn/photo.png',
			params: { images: ['https://three.ws/cdn/photo.png'] },
		});
		expect(sent).toEqual({ images: ['https://three.ws/cdn/photo.png'], body_type: 'neutral' });
		expect(submitted.viewsUsed).toBe(1);
		expect(submitted.multiview).toBe(false);
	});
});
