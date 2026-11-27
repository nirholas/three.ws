/**
 * Health probes must never wake a scaled-to-zero worker.
 *
 * Every GPU worker (and the CPU editing workers) runs with CPU always
 * allocated, so an instance bills for its whole life, and Cloud Run keeps an
 * idle instance up for about 15 minutes after its last request. Measured over
 * 24h on 2026-11-27: /api/forge?health (fetched by every Forge, Home, workbench
 * and Microsoft hub page view) sent 396 GET /health to model-hunyuan3d-21-rtx,
 * which ran zero jobs and still billed 15.4 GPU hours. /api/healthz, polled by
 * the Cloud Monitoring uptime check from a dozen regions, sent 7,042 GET
 * /health to granite-guardian against 27 real calls and kept its L4 up 24h.
 *
 * The fix reads Cloud Run's instance_count first and only probes /health on a
 * worker that is already running. These pin that a sleeping worker is reported
 * idle without being touched, a running one still gets the full /health check
 * (load_error included), and an unreadable metric falls back to the probe.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../api/_lib/gcp-auth.js', () => ({
	getGcpAccessToken: async () => 'test-token',
}));

import { cloudRunServiceFromUrl, resetWorkerWarmth } from '../api/_lib/worker-warmth.js';
import { probeForgeLane } from '../api/_lib/forge-health.js';
import { gatherSubsystemHealth } from '../api/_lib/ops/subsystem-health.js';
import { cacheDel } from '../api/_lib/cache.js';

const HUNYUAN_URL = 'https://model-hunyuan3d-21-rtx-93741856042.us-central1.run.app';
const GRANITE_URL = 'https://granite-guardian-93741856042.europe-west4.run.app';

const ENV_KEYS = ['GCP_HUNYUAN3D_URL', 'GCP_RECONSTRUCTION_KEY', 'GRANITE_GUARDIAN_URL', 'GCP_WORKERS_PROJECT', 'NODE_ENV'];
let savedEnv;
let calls;

function monitoringBody(rows) {
	return {
		timeSeries: rows.map(([service, location, count]) => ({
			resource: { labels: { service_name: service, location } },
			points: [{ interval: { endTime: new Date().toISOString() }, value: { int64Value: String(count) } }],
		})),
	};
}

function installFetch({ monitoring, health = { ready: true } }) {
	calls = [];
	globalThis.fetch = vi.fn(async (input) => {
		const url = String(input);
		calls.push(url);
		if (url.startsWith('https://monitoring.googleapis.com/')) {
			if (monitoring === 'fail') return new Response('denied', { status: 403 });
			return new Response(JSON.stringify(monitoringBody(monitoring)), { status: 200 });
		}
		if (url.endsWith('/health')) return new Response(JSON.stringify(health), { status: 200 });
		return new Response('{}', { status: 200 });
	});
}

const healthCalls = (base) => calls.filter((u) => u === `${base}/health`);

beforeEach(async () => {
	savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
	process.env.GCP_HUNYUAN3D_URL = HUNYUAN_URL;
	process.env.GCP_RECONSTRUCTION_KEY = 'k';
	process.env.GCP_WORKERS_PROJECT = 'workers-project';
	resetWorkerWarmth();
	await cacheDel('worker-warmth:v1:workers-project');
});

afterEach(() => {
	for (const [k, v] of Object.entries(savedEnv)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
	vi.restoreAllMocks();
});

describe('cloudRunServiceFromUrl', () => {
	it('reads the service and region from a project-number URL', () => {
		expect(cloudRunServiceFromUrl(HUNYUAN_URL)).toEqual({ service: 'model-hunyuan3d-21-rtx', region: 'us-central1' });
	});

	it('reads the service from a hashed regional URL', () => {
		expect(cloudRunServiceFromUrl('https://rembg-service-lp642k3kpa-uc.a.run.app/')).toEqual({ service: 'rembg-service', region: null });
	});

	it('returns null for anything that is not a run.app host', () => {
		expect(cloudRunServiceFromUrl('https://gpu.example.com')).toBe(null);
		expect(cloudRunServiceFromUrl('not a url')).toBe(null);
	});
});

describe('forge lane probes respect a sleeping worker', () => {
	it('reports a scaled-to-zero worker idle without calling /health', async () => {
		installFetch({ monitoring: [['model-hunyuan3d-21-rtx', 'us-central1', 0]] });
		const r = await probeForgeLane('hunyuan3d');
		expect(healthCalls(HUNYUAN_URL)).toHaveLength(0);
		expect(r.status).toBe('ok');
		expect(r.idle).toBe(true);
	});

	it('treats a worker missing from the metric as asleep', async () => {
		installFetch({ monitoring: [['some-other-service', 'us-central1', 2]] });
		const r = await probeForgeLane('hunyuan3d');
		expect(healthCalls(HUNYUAN_URL)).toHaveLength(0);
		expect(r.idle).toBe(true);
	});

	it('still runs the full /health check on a running worker', async () => {
		installFetch({ monitoring: [['model-hunyuan3d-21-rtx', 'us-central1', 1]], health: { load_error: 'CUDA OOM' } });
		const r = await probeForgeLane('hunyuan3d');
		expect(healthCalls(HUNYUAN_URL)).toHaveLength(1);
		expect(r.status).toBe('down');
		expect(r.idle).toBeUndefined();
	});

	it('falls back to probing when the metric cannot be read', async () => {
		installFetch({ monitoring: 'fail' });
		const r = await probeForgeLane('hunyuan3d');
		expect(healthCalls(HUNYUAN_URL)).toHaveLength(1);
		expect(r.status).toBe('ok');
	});

	it('reads the fleet once for many lanes', async () => {
		installFetch({ monitoring: [] });
		await probeForgeLane('hunyuan3d');
		await probeForgeLane('hunyuan3d');
		expect(calls.filter((u) => u.startsWith('https://monitoring.googleapis.com/'))).toHaveLength(1);
	});
});

describe('healthz does not keep granite-guardian awake', () => {
	it('skips the self-hosted /health probe while the worker is scaled to zero', async () => {
		process.env.GRANITE_GUARDIAN_URL = GRANITE_URL;
		installFetch({ monitoring: [['granite-guardian', 'europe-west4', 0]] });
		const out = await gatherSubsystemHealth({ probeDb: false });
		expect(healthCalls(GRANITE_URL)).toHaveLength(0);
		const g = out.subsystems.find((s) => s.name === 'granite_guardian');
		expect(g.status).toBe('ok');
		expect(g.detail).toMatch(/scaled to zero/);
	});

	it('probes it while it is running', async () => {
		process.env.GRANITE_GUARDIAN_URL = GRANITE_URL;
		installFetch({ monitoring: [['granite-guardian', 'europe-west4', 1]] });
		await gatherSubsystemHealth({ probeDb: false });
		expect(healthCalls(GRANITE_URL)).toHaveLength(1);
	});
});
