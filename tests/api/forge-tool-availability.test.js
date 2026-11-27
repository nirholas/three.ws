/**
 * Forge offers exactly what the worker fleet can deliver.
 *
 * Found on 2026-11-27 (forge-hardening order 83): production had no
 * MODEL_HOLOPART_URL, GCP_TEXTURE_URL or MODEL_LATO2_URL, yet the page offered
 * the three features those workers serve (Restyle "Regenerate part", Magic Brush
 * region retexture, and the Game-Ready "Artist mesh" topology). Each click ended
 * in a 501/503 that told the visitor to set an environment variable, or, for the
 * artist mesh, in a QuadriFlow mesh the visitor did not ask for.
 *
 * The fix: GET /api/forge?catalog carries a `tools` map whose `available` flag is
 * the same gate each tool's handler uses (the GCP provider's supportsMode, or the
 * USD worker config), so the page can hide or disable a tool before anyone
 * clicks. These tests pin that a tool whose worker env var is missing is
 * reported unavailable, and that the generation backends' `configured` flag
 * keeps doing the same for engines.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';

beforeAll(() => {
	process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters-long';
});

// The catalog never probes; keep the health module hermetic anyway.
vi.mock('../../api/_lib/forge-health.js', () => ({
	probeForgeHealth: vi.fn(async () => ({ status: 'ok', backends: {}, generated_at: 'now' })),
}));

const WORKER_ENV = [
	'GCP_RECONSTRUCTION_KEY',
	'GCP_REMESH_URL',
	'MODEL_LATO2_URL',
	'GCP_STYLIZE_URL',
	'GCP_SEGMENT_URL',
	'GCP_REMBG_URL',
	'GCP_UNIRIG_URL',
	'GCP_TEXT2MOTION_URL',
	'GCP_TEXTURE_URL',
	'MODEL_HOLOPART_URL',
	'MODEL_SAM3D_URL',
	'MODEL_TRIPOSPLAT_URL',
	'GCP_USD_EXPORT_URL',
	'MODEL_TRELLIS2_URL',
];

const saved = Object.fromEntries(WORKER_ENV.map((k) => [k, process.env[k]]));

function setEnv(values) {
	for (const k of WORKER_ENV) delete process.env[k];
	Object.assign(process.env, values);
}

afterEach(() => {
	for (const [k, v] of Object.entries(saved)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
});

// The worker set production had on 2026-11-27 (read from the three-ws-api
// service): remesh, stylize, segment, rembg, rig, text2motion, triposplat and
// USD export are set; lato2, texture, holopart and sam3d are not.
const PRODUCTION_2026_11_27 = {
	GCP_RECONSTRUCTION_KEY: 'test-key',
	GCP_REMESH_URL: 'https://remesh.example.run.app',
	GCP_STYLIZE_URL: 'https://stylize.example.run.app',
	GCP_SEGMENT_URL: 'https://segment.example.run.app',
	GCP_REMBG_URL: 'https://rembg.example.run.app',
	GCP_UNIRIG_URL: 'https://rig.example.run.app',
	GCP_TEXT2MOTION_URL: 'https://text2motion.example.run.app',
	MODEL_TRIPOSPLAT_URL: 'https://triposplat.example.run.app',
	GCP_USD_EXPORT_URL: 'https://usd.example.run.app',
};

describe('forgeToolAvailability', () => {
	it('reports a tool unavailable when its worker URL is missing, and available when set', async () => {
		const { forgeToolAvailability } = await import('../../api/_lib/forge-tool-availability.js');
		setEnv(PRODUCTION_2026_11_27);
		const tools = forgeToolAvailability();

		for (const id of ['remesh', 'stylize', 'segment', 'rembg', 'rig', 'text2motion', 'triposplat', 'usd_export']) {
			expect(tools[id]?.available, id).toBe(true);
		}
		for (const id of ['lato2', 'texture', 'holopart', 'sam3d']) {
			expect(tools[id]?.available, id).toBe(false);
		}

		setEnv({ ...PRODUCTION_2026_11_27, MODEL_HOLOPART_URL: 'https://holopart.example.run.app' });
		expect(forgeToolAvailability().holopart.available).toBe(true);
	});

	it('reports every worker tool unavailable when the shared worker key is missing', async () => {
		const { forgeToolAvailability } = await import('../../api/_lib/forge-tool-availability.js');
		const { GCP_RECONSTRUCTION_KEY: _key, ...urlsOnly } = PRODUCTION_2026_11_27;
		setEnv(urlsOnly);
		const tools = forgeToolAvailability();
		for (const [id, t] of Object.entries(tools)) expect(t.available, id).toBe(false);
	});

	it('never leaks an env var name or worker address into the public payload', async () => {
		const { forgeToolAvailability } = await import('../../api/_lib/forge-tool-availability.js');
		setEnv(PRODUCTION_2026_11_27);
		const text = JSON.stringify(forgeToolAvailability());
		expect(text).not.toMatch(/_URL|_KEY|run\.app|example/);
	});
});

describe('GET /api/forge?catalog', () => {
	function makeReq(url) {
		return { method: 'GET', url, headers: { 'content-type': 'application/json' }, on() {} };
	}
	function makeRes() {
		return {
			statusCode: 200,
			headers: {},
			body: null,
			setHeader(name, value) {
				this.headers[String(name).toLowerCase()] = value;
			},
			getHeader(name) {
				return this.headers[String(name).toLowerCase()];
			},
			end(body) {
				this.body = body ? JSON.parse(body) : null;
			},
		};
	}

	it('reports a tool whose worker env var is missing as unavailable', async () => {
		setEnv(PRODUCTION_2026_11_27);
		const { default: handler } = await import('../../api/forge.js');
		const res = makeRes();
		await handler(makeReq('/api/forge?catalog=1'), res);

		expect(res.statusCode).toBe(200);
		expect(res.body.tools?.holopart?.available).toBe(false);
		expect(res.body.tools?.texture?.available).toBe(false);
		expect(res.body.tools?.lato2?.available).toBe(false);
		expect(res.body.tools?.remesh?.available).toBe(true);
	});

	it('reports a generation engine whose worker env var is missing as not configured', async () => {
		setEnv(PRODUCTION_2026_11_27);
		const { default: handler } = await import('../../api/forge.js');
		const res = makeRes();
		await handler(makeReq('/api/forge?catalog=1'), res);

		const trellis2 = res.body.backends.find((b) => b.id === 'trellis2');
		expect(trellis2.configured).toBe(false);
	});
});
