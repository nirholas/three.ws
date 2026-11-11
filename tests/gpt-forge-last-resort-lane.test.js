// The ChatGPT app's forge_free / mesh_forge failed with "no reconstruct lane
// configured" while our own TRELLIS worker was up.
//
// The studio tools call /api/gpt-forge server to server, so the request carries
// no geo header. An unknown country fails closed on the Tencent licence
// territory rule (api/_lib/forge-territory.js), which removes Hunyuan3D and the
// HuggingFace chain. The TRELLIS self-host worker's health probe times out while
// the instance is busy on a job, so the snapshot read it "down". NVIDIA and the
// Replicate lane were unavailable. The submit-time fallback skipped self-host on
// that advisory "down", skipped the two Tencent lanes, and threw, even though
// self-host would have accepted the job.
//
// Contract pinned here: when every lane the fallback normally walks is gone, a
// configured lane the territory rule allows is still tried before the request
// fails, and its job comes back pollable.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Readable } from 'node:stream';

const { gcpSubmit, laneHealth } = vi.hoisted(() => ({
	gcpSubmit: vi.fn(),
	laneHealth: vi.fn(),
}));

// The FLUX reference image is the network edge of the text path; the NIM lane
// is in its recent-failure cooldown (it returned 504s in production).
vi.mock('../api/_mcp3d/text-to-image.js', async (importOriginal) => {
	const real = await importOriginal();
	return {
		...real,
		textToImage: async () => ({ imageUrl: 'https://three.ws/cdn/forge/test/robot-reference.png', model: 'flux-test' }),
	};
});
vi.mock('../api/_lib/provider-health.js', async (importOriginal) => {
	const real = await importOriginal();
	return {
		...real,
		providersInCooldown: async (keys = []) => new Set(keys.filter((k) => k === 'forge-nim-trellis')),
		markProviderCooldown: async () => {},
	};
});

vi.mock('../api/_providers/gcp.js', async (importOriginal) => {
	const real = await importOriginal();
	return { ...real, createRegenProvider: () => ({ submit: gcpSubmit }) };
});
vi.mock('../api/_lib/forge-lane-health.js', async (importOriginal) => {
	const real = await importOriginal();
	return {
		...real,
		laneHealthSnapshot: (...args) => laneHealth(...args),
		markLaneUnhealthy: async () => {},
	};
});

const LANE_ENV = {
	MODEL_TRELLIS_URL: 'https://trellis.test',
	GCP_RECONSTRUCTION_KEY: 'test-key',
	GCP_HUNYUAN3D_URL: 'https://hunyuan.test',
	HF_TOKEN: 'hf-test',
	NVIDIA_API_KEY: 'nvapi-test',
	FORGE_REFERENCE_IMAGE: 'off',
};
const CLEARED_ENV = ['REPLICATE_API_TOKEN', 'GCP_TRIPOSG_URL', 'MODEL_MODLY_URL', 'MODEL_TRELLIS2_URL'];
const saved = {};

function mockRes() {
	return {
		statusCode: 200, _headers: {}, _body: '', _ended: false,
		setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
		getHeader(k) { return this._headers[k.toLowerCase()]; },
		end(b) { this._body = b || ''; this._ended = true; },
		get json() { try { return JSON.parse(this._body); } catch { return null; } },
	};
}

function mockReq(body) {
	const r = Readable.from([Buffer.from(JSON.stringify(body))]);
	r.method = 'POST';
	r.url = '/api/gpt-forge';
	// No geo header: exactly what the server-to-server studio call sends.
	r.headers = { origin: 'http://localhost:3000', 'content-type': 'application/json' };
	return r;
}

beforeEach(() => {
	vi.resetModules();
	process.env.NODE_ENV = 'development';
	process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
	for (const k of [...Object.keys(LANE_ENV), ...CLEARED_ENV]) saved[k] = process.env[k];
	Object.assign(process.env, LANE_ENV);
	for (const k of CLEARED_ENV) delete process.env[k];
	gcpSubmit.mockReset();
	gcpSubmit.mockResolvedValue({ extJobId: 'trellis-task-1' });
	// The busy self-host worker's probe timed out: advisory "down".
	laneHealth.mockReset();
	laneHealth.mockImplementation(async (ids = []) => {
		const statusMap = Object.fromEntries(ids.map((id) => [id, id === 'trellis_selfhost' ? 'down' : 'unknown']));
		const byId = Object.fromEntries(Object.entries(statusMap).map(([id, status]) => [id, { status }]));
		return { statusMap, byId };
	});
});

afterEach(() => {
	for (const [k, v] of Object.entries(saved)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
	vi.restoreAllMocks();
});

// Both forge handlers carry the same submit-time fallback chain.
describe.each([
	['/api/gpt-forge', '../api/gpt-forge.js'],
	['/api/forge', '../api/forge.js'],
])('POST %s with no lane left but a probe-"down" self-host worker', (route, modPath) => {
	it('submits to TRELLIS self-host instead of failing with "no reconstruct lane configured"', async () => {
		const forge = (await import(modPath)).default;
		const res = mockRes();
		const req = mockReq({ prompt: 'a friendly round robot mascot, glossy white plastic', director: false });
		req.url = route;
		await forge(req, res);
		expect(res.json?.message || '').not.toMatch(/no reconstruct lane configured/);
		expect(res.statusCode).toBe(200);
		expect(res.json.backend).toBe('trellis_selfhost');
		expect(typeof res.json.job_id).toBe('string');
		expect(gcpSubmit).toHaveBeenCalled();
		expect(gcpSubmit.mock.calls.at(-1)[0].mode).toBe('trellis');
	});

	it('still fails cleanly when the last configured lane refuses the job too', async () => {
		gcpSubmit.mockRejectedValue(Object.assign(new Error('worker unreachable'), { code: 'provider_unreachable', status: 502 }));
		const forge = (await import(modPath)).default;
		const res = mockRes();
		const req = mockReq({ prompt: 'a friendly round robot mascot, glossy white plastic', director: false });
		req.url = route;
		await forge(req, res);
		expect(res.statusCode).toBeGreaterThanOrEqual(400);
		expect(res.json?.job_id).toBeUndefined();
	});
});
