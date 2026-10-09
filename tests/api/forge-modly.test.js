// The Modly lanes: registration, env gating, free-first routing placement,
// territory, the gcp provider's `modly` / `modly_hunyuan` wire contract, the
// self-host retry order, the poll-time failover rung and the health probe.
//
// One Modly worker (workers/modly, Modly by Lightning Pixel, MIT) serves both
// lanes: `modly` runs VAST AI's TripoSG, `modly_hunyuan` runs Tencent's
// Hunyuan3D 2 Mini Turbo. Both return untextured geometry, repaired and then
// decimated to the tier's poly budget by Modly's own mesh optimizer, so they
// rank below every textured free lane and TRELLIS.2 stays the default.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	BACKENDS,
	FREE_DEFAULT_FOR_TIERS,
	FREE_FALLBACK_FOR_PATH,
	MODLY_LANES,
	backendIsConfigured,
	buildCatalog,
	freeLaneCandidates,
	isSelfHostImageLane,
	nextSelfHostImageLane,
	resolveBackendId,
	selfHostLaneName,
} from '../../api/_lib/forge-tiers.js';
import { TENCENT_LANES, laneAllowedInTerritory } from '../../api/_lib/forge-territory.js';
import { MODLY_MODEL_FOR_MODE, createRegenProvider } from '../../api/_providers/gcp.js';
import { retryBackendSuggestions, submitFailoverJob } from '../../api/_lib/forge-failover.js';
import { KEEPWARM_LANES } from '../../api/cron/gpu-keepwarm.js';
import { decodeJobToken } from '../../api/_lib/forge-job-token.js';

const VARS = [
	'MODEL_MODLY_URL',
	'MODEL_TRELLIS_URL',
	'MODEL_TRELLIS2_URL',
	'GCP_HUNYUAN3D_URL',
	'GCP_TRIPOSG_URL',
	'GCP_RECONSTRUCTION_KEY',
	'NVIDIA_API_KEY',
	'HF_TOKEN',
	'REPLICATE_API_TOKEN',
	'FORGE_SELFHOST_PRIMARY',
	'JWT_SECRET',
];
const saved = {};
const ORIGINAL_FETCH = globalThis.fetch;
const MODLY_URL = 'https://model-modly.example.run.app';

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

function captureInfer(taskId = 'task-modly') {
	const sent = [];
	globalThis.fetch = vi.fn(async (url, opts) => {
		sent.push({ url: String(url), body: JSON.parse(opts.body), headers: opts.headers });
		return new Response(JSON.stringify({ task_id: taskId, status: 'queued' }), {
			status: 202,
			headers: { 'content-type': 'application/json' },
		});
	});
	return sent;
}

describe('forge-tiers: Modly lane registration', () => {
	it('registers both lanes as free, image-path, poly-aware self-host lanes on the gcp provider', () => {
		for (const id of ['modly', 'modly_hunyuan']) {
			const b = BACKENDS[id];
			expect(b, id).toBeTruthy();
			expect(b.id).toBe(id);
			expect(b.provider).toBe('gcp');
			expect(b.paths).toEqual(['image']);
			expect(b.byok).toBe(false);
			expect(b.free).toBe(true);
			expect(b.credits).toBeNull();
			expect(b.userImages).toBe(true);
			expect(b.polyControl).toBe(true);
			expect(b.coldStartSeconds).toBeGreaterThan(0);
			expect(b.requiresEnv).toEqual(['MODEL_MODLY_URL', 'GCP_RECONSTRUCTION_KEY']);
			expect(b.blurb).toMatch(/Untextured/);
		}
		expect(MODLY_LANES).toEqual(['modly', 'modly_hunyuan']);
	});

	it('is configured only when both the worker URL and the shared worker key are set', () => {
		expect(backendIsConfigured('modly')).toBe(false);
		process.env.MODEL_MODLY_URL = MODLY_URL;
		expect(backendIsConfigured('modly')).toBe(false);
		expect(backendIsConfigured('modly_hunyuan')).toBe(false);
		process.env.GCP_RECONSTRUCTION_KEY = 'secret';
		expect(backendIsConfigured('modly')).toBe(true);
		expect(backendIsConfigured('modly_hunyuan')).toBe(true);
	});

	it('shows up in the catalog as configured once both vars are set', () => {
		const before = buildCatalog().backends.find((x) => x.id === 'modly');
		expect(before?.configured).toBe(false);
		process.env.MODEL_MODLY_URL = MODLY_URL;
		process.env.GCP_RECONSTRUCTION_KEY = 'secret';
		const after = buildCatalog().backends.find((x) => x.id === 'modly');
		expect(after?.configured).toBe(true);
		expect(after?.free).toBe(true);
	});
});

describe('forge-tiers: Modly routing placement', () => {
	it('never replaces TRELLIS.2 as a named tier default', () => {
		for (const tier of ['draft', 'standard', 'high']) {
			expect(FREE_DEFAULT_FOR_TIERS[tier].image).toBe('trellis2');
		}
	});

	it('ranks below every textured free lane and above the text-only NVIDIA fallthrough', () => {
		const chain = FREE_FALLBACK_FOR_PATH.image;
		const hf = chain.indexOf('huggingface');
		const modly = chain.indexOf('modly');
		const modlyHunyuan = chain.indexOf('modly_hunyuan');
		expect(hf).toBeGreaterThan(-1);
		expect(modly).toBe(hf + 1);
		expect(modlyHunyuan).toBe(modly + 1);
		expect(chain.indexOf('nvidia')).toBe(modlyHunyuan + 1);
	});

	it('serves a photo when the Modly worker is the only free lane configured', () => {
		process.env.MODEL_MODLY_URL = MODLY_URL;
		process.env.GCP_RECONSTRUCTION_KEY = 'secret';
		expect(resolveBackendId({ path: 'image', tier: 'standard', userImages: true, country: 'US' })).toBe('modly');
		expect(freeLaneCandidates('image', 'standard', true, null, 'US')).toEqual(['modly', 'modly_hunyuan']);
	});

	it('keeps TRELLIS.2 first when both workers are configured', () => {
		process.env.MODEL_MODLY_URL = MODLY_URL;
		process.env.MODEL_TRELLIS2_URL = 'https://trellis2.example.run.app';
		process.env.GCP_RECONSTRUCTION_KEY = 'secret';
		for (const tier of ['draft', 'standard', 'high']) {
			expect(resolveBackendId({ path: 'image', tier, userImages: true, country: 'US' })).toBe('trellis2');
		}
		expect(freeLaneCandidates('image', 'standard', true, null, 'US')).toEqual(['trellis2', 'modly', 'modly_hunyuan']);
	});

	it('honours an explicit pick of either lane', () => {
		process.env.MODEL_MODLY_URL = MODLY_URL;
		process.env.MODEL_TRELLIS2_URL = 'https://trellis2.example.run.app';
		process.env.GCP_RECONSTRUCTION_KEY = 'secret';
		expect(resolveBackendId({ path: 'image', tier: 'standard', backend: 'modly', userImages: true, country: 'US' })).toBe('modly');
		expect(
			resolveBackendId({ path: 'image', tier: 'standard', backend: 'modly_hunyuan', userImages: true, country: 'US' }),
		).toBe('modly_hunyuan');
	});
});

describe('forge-territory: Modly lanes', () => {
	it('treats the Hunyuan3D lane as a Tencent lane and TripoSG as territory-free', () => {
		expect(TENCENT_LANES).toContain('modly_hunyuan');
		expect(TENCENT_LANES).not.toContain('modly');
		for (const country of ['DE', 'GB', 'KR', null]) {
			expect(laneAllowedInTerritory('modly', country)).toBe(true);
			expect(laneAllowedInTerritory('modly_hunyuan', country)).toBe(false);
		}
		expect(laneAllowedInTerritory('modly_hunyuan', 'US')).toBe(true);
	});

	it('drops the Hunyuan3D lane from restricted-territory free routing', () => {
		process.env.MODEL_MODLY_URL = MODLY_URL;
		process.env.GCP_RECONSTRUCTION_KEY = 'secret';
		expect(freeLaneCandidates('image', 'standard', true, null, 'FR')).toEqual(['modly']);
		expect(freeLaneCandidates('image', 'standard', true, null, null)).toEqual(['modly']);
	});
});

describe('gcp provider: Modly wire contract', () => {
	beforeEach(() => {
		process.env.MODEL_MODLY_URL = MODLY_URL;
		process.env.GCP_RECONSTRUCTION_KEY = 'secret';
	});

	it('maps each lane to the model id the worker serves', () => {
		expect(MODLY_MODEL_FOR_MODE).toEqual({ modly: 'triposg', modly_hunyuan: 'hunyuan3d-mini-turbo' });
	});

	it('submits TripoSG with tier, seed, a repair pass and the poly budget as the decimate target', async () => {
		const sent = captureInfer();
		const submitted = await createRegenProvider().submit({
			mode: 'modly',
			sourceUrl: 'https://three.ws/cdn/photo.png',
			params: {
				images: ['https://three.ws/cdn/photo.png'],
				tier: 'standard',
				seed: 42,
				target_polycount: 30000,
			},
		});
		expect(sent).toHaveLength(1);
		expect(sent[0].url).toBe(`${MODLY_URL}/infer`);
		expect(sent[0].headers.authorization).toBe('Bearer secret');
		expect(sent[0].body).toEqual({
			images: ['https://three.ws/cdn/photo.png'],
			body_type: 'neutral',
			model: 'triposg',
			tier: 'standard',
			seed: 42,
			postprocess: { repair: true, decimate: { target_faces: 30000 } },
		});
		expect(submitted.backend).toBe('gcp');
		expect(submitted.viewsUsed).toBe(1);
		expect(submitted.multiview).toBe(false);
		expect(submitted.eta).toBeGreaterThan(0);
	});

	it('routes the Hunyuan lane to the same worker with its own model id', async () => {
		const sent = captureInfer();
		await createRegenProvider().submit({
			mode: 'modly_hunyuan',
			sourceUrl: 'https://three.ws/cdn/photo.png',
			params: { images: ['https://three.ws/cdn/photo.png'], tier: 'draft', target_polycount: 12000 },
		});
		expect(sent[0].url).toBe(`${MODLY_URL}/infer`);
		expect(sent[0].body.model).toBe('hunyuan3d-mini-turbo');
		expect(sent[0].body.postprocess.decimate).toEqual({ target_faces: 12000 });
	});

	it('clamps the decimate target to the bounds the worker accepts', async () => {
		const sent = captureInfer();
		const provider = createRegenProvider();
		for (const target_polycount of [5_000_000, 12]) {
			await provider.submit({
				mode: 'modly',
				sourceUrl: 'https://three.ws/cdn/photo.png',
				params: { images: ['https://three.ws/cdn/photo.png'], target_polycount },
			});
		}
		expect(sent[0].body.postprocess.decimate.target_faces).toBe(1_000_000);
		expect(sent[1].body.postprocess.decimate.target_faces).toBe(100);
	});

	it('still repairs but skips decimation when no budget is given', async () => {
		const sent = captureInfer();
		await createRegenProvider().submit({
			mode: 'modly',
			sourceUrl: 'https://three.ws/cdn/photo.png',
			params: {},
		});
		expect(sent[0].body.images).toEqual(['https://three.ws/cdn/photo.png']);
		expect(sent[0].body.postprocess).toEqual({ repair: true });
		expect(sent[0].body).not.toHaveProperty('seed');
		expect(sent[0].body).not.toHaveProperty('tier');
	});

	it('polls /tasks/:id and surfaces result_gcs_url as the GLB on done', async () => {
		globalThis.fetch = vi.fn(async (url) => {
			if (String(url).endsWith('/infer')) {
				return new Response(JSON.stringify({ task_id: 'task-m1', status: 'queued' }), { status: 202 });
			}
			expect(String(url)).toBe(`${MODLY_URL}/tasks/task-m1`);
			return new Response(
				JSON.stringify({
					task_id: 'task-m1',
					status: 'done',
					result_gcs_url: 'https://storage.googleapis.com/bucket/raw-meshes/modly/task-m1.glb',
				}),
				{ status: 200 },
			);
		});
		const provider = createRegenProvider();
		const submitted = await provider.submit({
			mode: 'modly',
			sourceUrl: 'https://three.ws/cdn/photo.png',
			params: { images: ['https://three.ws/cdn/photo.png'] },
		});
		const status = await provider.status(submitted.extJobId);
		expect(status.status).toBe('done');
		expect(status.resultGlbUrl).toBe('https://storage.googleapis.com/bucket/raw-meshes/modly/task-m1.glb');
	});

	it('reports both modes unsupported without the worker URL', () => {
		delete process.env.MODEL_MODLY_URL;
		const provider = createRegenProvider();
		expect(provider.supportsMode('modly')).toBe(false);
		expect(provider.supportsMode('modly_hunyuan')).toBe(false);
	});
});

describe('self-host image lane helpers', () => {
	it('covers both TRELLIS workers and both Modly lanes', () => {
		for (const id of ['trellis2', 'trellis_selfhost', 'modly', 'modly_hunyuan']) {
			expect(isSelfHostImageLane(id)).toBe(true);
		}
		for (const id of ['hunyuan3d', 'huggingface', 'trellis', 'triposg']) {
			expect(isSelfHostImageLane(id)).toBe(false);
		}
	});

	it('names each lane in its not-configured message', () => {
		expect(selfHostLaneName('trellis2')).toBe('Self-hosted TRELLIS');
		expect(selfHostLaneName('modly')).toBe(BACKENDS.modly.label);
		expect(selfHostLaneName('modly_hunyuan')).toBe(BACKENDS.modly_hunyuan.label);
	});

	it('retries a down Modly worker on TRELLIS.2, then TRELLIS v1, never on its sibling', () => {
		process.env.GCP_RECONSTRUCTION_KEY = 'secret';
		process.env.MODEL_MODLY_URL = MODLY_URL;
		expect(nextSelfHostImageLane('modly')).toBeNull();
		process.env.MODEL_TRELLIS_URL = 'https://trellis.example.run.app';
		expect(nextSelfHostImageLane('modly')).toBe('trellis_selfhost');
		expect(nextSelfHostImageLane('modly_hunyuan')).toBe('trellis_selfhost');
		process.env.MODEL_TRELLIS2_URL = 'https://trellis2.example.run.app';
		expect(nextSelfHostImageLane('modly')).toBe('trellis2');
		expect(nextSelfHostImageLane('trellis2')).toBe('trellis_selfhost');
		expect(nextSelfHostImageLane('trellis_selfhost')).toBeNull();
	});
});

describe('forge-failover: Modly lanes', () => {
	it('suggests the Modly lanes last, after every textured lane', () => {
		process.env.GCP_RECONSTRUCTION_KEY = 'secret';
		process.env.MODEL_MODLY_URL = MODLY_URL;
		process.env.MODEL_TRELLIS2_URL = 'https://trellis2.example.run.app';
		expect(retryBackendSuggestions({ hasImage: true, country: 'US' })).toEqual(['trellis2', 'modly', 'modly_hunyuan']);
		expect(retryBackendSuggestions({ hasImage: true, country: 'DE' })).toEqual(['trellis2', 'modly']);
		expect(retryBackendSuggestions({ hasImage: true, attempted: ['trellis2', 'modly'], country: 'US' })).toEqual([
			'modly_hunyuan',
		]);
	});

	it('redispatches a failed job to the Modly worker with the tier budget', async () => {
		process.env.GCP_RECONSTRUCTION_KEY = 'secret';
		process.env.MODEL_MODLY_URL = MODLY_URL;
		// The poll handle is a signed forge job token.
		process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long';
		const sent = captureInfer('task-failover');
		const out = await submitFailoverJob({
			backend: 'modly_hunyuan',
			imageUrl: 'https://three.ws/cdn/ref.png',
			prompt: 'a ceramic teapot',
			tierId: 'standard',
			path: 'image',
		});
		expect(sent[0].url).toBe(`${MODLY_URL}/infer`);
		expect(sent[0].body).toMatchObject({
			images: ['https://three.ws/cdn/ref.png'],
			model: 'hunyuan3d-mini-turbo',
			tier: 'standard',
			postprocess: { repair: true, decimate: { target_faces: 30000 } },
		});
		expect(out.extJobId).toBeTruthy();
		expect(decodeJobToken(out.handle)).toMatchObject({ provider: 'gcp', taskId: out.extJobId });
	});
});

describe('gpu-keepwarm: Modly worker', () => {
	it('lists both lanes against the one worker URL, quota-gated', () => {
		for (const id of ['modly', 'modly_hunyuan']) {
			const lane = KEEPWARM_LANES.find((l) => l.id === id);
			expect(lane, id).toBeTruthy();
			expect(lane.urlEnv).toBe('MODEL_MODLY_URL');
			expect(lane.safeByDefault).toBe(false);
		}
	});
});
