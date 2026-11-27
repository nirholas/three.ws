// Self-host lane liveness/warmth probe — the signal health-aware routing consults.
//
// A self-host worker is probed with a cheap authenticated GET against its
// /health route: 5xx/timeout/unreachable = down, a populated load_error = down,
// otherwise up (warm only when the answer is fast AND the model is loaded).
// External free lanes are reported unknown (they carry their own breakers).
// Everything is fail-open and cached per instance.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { laneHealthSnapshot, resetLaneHealthCache, laneCooldownKey } from '../../api/_lib/forge-lane-health.js';
import { resolveBackendIdWithHealth } from '../../api/_lib/forge-tiers.js';

const VARS = ['MODEL_TRELLIS_URL', 'GCP_HUNYUAN3D_URL', 'GCP_RECONSTRUCTION_KEY', 'HF_TOKEN'];
const saved = {};
const ORIGINAL_FETCH = globalThis.fetch;

beforeEach(() => {
	for (const v of VARS) {
		saved[v] = process.env[v];
		delete process.env[v];
	}
	resetLaneHealthCache();
});
afterEach(() => {
	for (const v of VARS) {
		if (saved[v] === undefined) delete process.env[v];
		else process.env[v] = saved[v];
	}
	globalThis.fetch = ORIGINAL_FETCH;
	vi.restoreAllMocks();
	resetLaneHealthCache();
});

describe('laneHealthSnapshot — self-host worker probing', () => {
	it('reports a reachable worker ok (warm on a fast answer)', async () => {
		process.env.MODEL_TRELLIS_URL = 'https://trellis.example.run.app';
		process.env.GCP_RECONSTRUCTION_KEY = 'secret';
		globalThis.fetch = vi.fn(async (url, opts) => {
			expect(url).toBe('https://trellis.example.run.app/health');
			expect(opts.headers.authorization).toBe('Bearer secret');
			return new Response(JSON.stringify({ ok: true, ready: true }), { status: 200 });
		});

		const snap = await laneHealthSnapshot(['trellis_selfhost']);
		expect(snap.statusMap.trellis_selfhost).toBe('ok');
		expect(snap.byId.trellis_selfhost.warm).toBe(true);
	});

	// Routing consulted the service ROOT until 2026-08-11 and read the 404 no
	// worker serves as a healthy lane, so generations kept being routed at a
	// worker whose weight load had failed. These pin the readiness reading.
	it('reports a worker whose model load failed as down', async () => {
		process.env.GCP_HUNYUAN3D_URL = 'https://hunyuan.example.run.app';
		process.env.GCP_RECONSTRUCTION_KEY = 'secret';
		globalThis.fetch = vi.fn(
			async () =>
				new Response(JSON.stringify({ ok: true, ready: false, load_error: 'internal error (ref 9f2c1a)' }), {
					status: 200,
				}),
		);

		const snap = await laneHealthSnapshot(['hunyuan3d']);
		expect(snap.statusMap.hunyuan3d).toBe('down');
		expect(snap.byId.hunyuan3d.warm).toBe(false);
	});

	it('reports a worker still loading its weights as up but never warm', async () => {
		process.env.GCP_HUNYUAN3D_URL = 'https://hunyuan.example.run.app';
		process.env.GCP_RECONSTRUCTION_KEY = 'secret';
		globalThis.fetch = vi.fn(
			async () =>
				new Response(JSON.stringify({ ok: true, pipeline_loaded: false, ready: false, load_error: null }), {
					status: 200,
				}),
		);

		const snap = await laneHealthSnapshot(['hunyuan3d']);
		expect(snap.statusMap.hunyuan3d).toBe('ok');
		expect(snap.byId.hunyuan3d.warm).toBe(false);
	});

	it('falls open to ok for a routable worker that publishes no health body', async () => {
		process.env.GCP_HUNYUAN3D_URL = 'https://hunyuan.example.run.app';
		process.env.GCP_RECONSTRUCTION_KEY = 'secret';
		globalThis.fetch = vi.fn(async () => new Response('not found', { status: 404 }));

		const snap = await laneHealthSnapshot(['hunyuan3d']);
		expect(snap.statusMap.hunyuan3d).toBe('ok');
	});

	it('reports a 5xx worker down', async () => {
		process.env.GCP_HUNYUAN3D_URL = 'https://hunyuan.example.run.app';
		process.env.GCP_RECONSTRUCTION_KEY = 'secret';
		globalThis.fetch = vi.fn(async () => new Response('boom', { status: 503 }));

		const snap = await laneHealthSnapshot(['hunyuan3d']);
		expect(snap.statusMap.hunyuan3d).toBe('down');
	});

	it('reports an unreachable worker down (fetch throws)', async () => {
		process.env.MODEL_TRELLIS_URL = 'https://trellis.example.run.app';
		process.env.GCP_RECONSTRUCTION_KEY = 'secret';
		globalThis.fetch = vi.fn(async () => {
			throw new Error('ECONNREFUSED');
		});

		const snap = await laneHealthSnapshot(['trellis_selfhost']);
		expect(snap.statusMap.trellis_selfhost).toBe('down');
	});

	it('reports an unconfigured self-host lane unknown without probing', async () => {
		const fetchMock = vi.fn();
		globalThis.fetch = fetchMock;
		const snap = await laneHealthSnapshot(['trellis_selfhost']);
		expect(snap.statusMap.trellis_selfhost).toBe('unknown');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('reports external free lanes unknown (no probe, their own breaker owns liveness)', async () => {
		process.env.HF_TOKEN = 'hf_test';
		const fetchMock = vi.fn();
		globalThis.fetch = fetchMock;
		const snap = await laneHealthSnapshot(['huggingface', 'nvidia']);
		expect(snap.statusMap.huggingface).toBe('unknown');
		expect(snap.statusMap.nvidia).toBe('unknown');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('caches the snapshot per instance — a second call does not re-probe', async () => {
		process.env.MODEL_TRELLIS_URL = 'https://trellis.example.run.app';
		process.env.GCP_RECONSTRUCTION_KEY = 'secret';
		const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
		globalThis.fetch = fetchMock;

		await laneHealthSnapshot(['trellis_selfhost']);
		await laneHealthSnapshot(['trellis_selfhost']);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	// The cooldown a submit failure records is shared across instances, but this
	// instance's cached snapshot still held the probe it took before the failure,
	// so for up to 20s the router (and the submit fallback chain) read the lane
	// that had just refused as `ok` and sent it the next job anyway.
	it('reads a lane as down the moment a failure cools it, even inside the snapshot cache window', async () => {
		process.env.MODEL_TRELLIS_URL = 'https://trellis.example.run.app';
		process.env.GCP_RECONSTRUCTION_KEY = 'secret';
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ready: true }), { status: 200 }));
		globalThis.fetch = fetchMock;
		const { markLaneUnhealthy } = await import('../../api/_lib/forge-lane-health.js');
		const { clearProviderCooldown } = await import('../../api/_lib/provider-health.js');

		expect((await laneHealthSnapshot(['trellis_selfhost'])).statusMap.trellis_selfhost).toBe('ok');
		try {
			await markLaneUnhealthy('trellis_selfhost');
			const after = await laneHealthSnapshot(['trellis_selfhost']);
			expect(after.statusMap.trellis_selfhost).toBe('down');
			expect(after.byId.trellis_selfhost.cooled).toBe(true);
			// No second probe was spent to learn it.
			expect(fetchMock).toHaveBeenCalledTimes(1);
		} finally {
			await clearProviderCooldown(laneCooldownKey('trellis_selfhost'));
		}
	});

	it('exposes a distinct cooldown key namespace per lane', () => {
		expect(laneCooldownKey('trellis_selfhost')).toBe('forge-lane:trellis_selfhost');
		expect(laneCooldownKey('triposg')).toBe('forge-lane:triposg');
	});

	// The exact body the self-hosted TRELLIS worker served on 2026-09-17/18 after
	// a torch.hub GitHub probe 403'd its model load: HTTP 200, ok:true, and the
	// failure only visible in load_error. trellis_selfhost is the named default
	// for draft/standard image requests, so routing must read this as down and
	// hand the request to the next free lane instead of submitting to a corpse.
	it('reads a latched TRELLIS load failure served as HTTP 200 ok:true as down, and routes past it', async () => {
		process.env.MODEL_TRELLIS_URL = 'https://trellis.example.run.app';
		process.env.GCP_HUNYUAN3D_URL = 'https://hunyuan.example.run.app';
		process.env.GCP_RECONSTRUCTION_KEY = 'secret';
		globalThis.fetch = vi.fn(async (url) => {
			if (String(url).startsWith('https://trellis.example.run.app')) {
				return new Response(
					JSON.stringify({
						ok: true,
						model: 'trellis-image-large',
						gpu_available: true,
						gpu_name: 'NVIDIA L4',
						pipeline_loaded: false,
						ready: false,
						load_error: 'internal error (ref 6eddca0af4eb)',
					}),
					{ status: 200 },
				);
			}
			return new Response(JSON.stringify({ ok: true, pipeline_loaded: true, ready: true, load_error: null }), {
				status: 200,
			});
		});

		const snap = await laneHealthSnapshot(['trellis_selfhost', 'hunyuan3d']);
		expect(snap.statusMap.trellis_selfhost).toBe('down');
		expect(snap.statusMap.hunyuan3d).toBe('ok');
		for (const tier of ['draft', 'standard']) {
			const chosen = resolveBackendIdWithHealth({ path: 'image', tier, health: snap.statusMap });
			expect(chosen).not.toBe('trellis_selfhost');
		}
	});
});
