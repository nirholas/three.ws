/**
 * Submit-time health gate for "Match my photo": when the lane's recent success
 * is below threshold a photo goes straight to the standard TRELLIS lane and the
 * response says so; when the lane is healthy the request reaches pixal3d.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// POST /api/forge needs an account (api/_lib/creator-account.js). These tests
// exercise what happens past that gate, so the caller is a signed-in account.
vi.mock('../../api/_lib/auth.js', async (orig) => ({
	...(await orig()),
	getRequestUser: async () => ({ id: 'forge-test-user' }),
}));

beforeAll(() => {
	Object.assign(process.env, {
		APP_ORIGIN: 'https://three.ws',
		MODEL_PIXAL3D_URL: 'https://pixal3d.example.run.app',
		MODEL_TRELLIS_URL: 'https://trellis.example.run.app',
		GCP_RECONSTRUCTION_KEY: 'test-gcp-key',
		NVIDIA_API_KEY: 'nvapi-test',
		JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
	});
});

const gcpSubmit = vi.fn(async ({ params }) => ({
	extJobId: 'gcpjob-pixal3d-01',
	viewsUsed: params.images.length,
	multiview: params.images.length > 1,
}));
vi.mock('../../api/_providers/gcp.js', () => ({
	createRegenProvider: () => ({ submit: gcpSubmit }),
}));

vi.mock('../../api/_mcp3d/text-to-image.js', () => ({
	textToImage: vi.fn(async () => ({ imageUrl: 'https://cdn.example/ref.png', model: 'flux' })),
	synthesizeTurnaroundViews: vi.fn(async () => []),
}));

const createCreation = vi.fn(async () => 'creation-pixal3d-1');
vi.mock('../../api/_lib/forge-store.js', () => ({
	hashClient: (v) => `client:${v || 'anon'}`,
	hashIp: (v) => `ip:${v}`,
	createCreation,
	materializeCreation: vi.fn(async ({ glbUrl }) => ({ id: 'creation-pixal3d-1', glbUrl })),
	markFailed: vi.fn(async () => {}),
	findByJob: vi.fn(async () => null),
	runWithCreationContext: (_facts, fn) => fn(),
}));

vi.mock('../../api/_lib/forge-lane-health.js', () => ({
	laneHealthSnapshot: vi.fn(async () => ({ statusMap: {}, byId: {} })),
	markLaneUnhealthy: vi.fn(async () => {}),
	laneCooldownKey: (id) => `forge-lane:${id}`,
}));

vi.mock('../../api/_lib/forge-image-validate.js', () => ({
	validateForgeImage: vi.fn(async () => ({ ok: true })),
}));

vi.mock('../../api/_lib/rate-limit.js', async (importActual) => {
	const actual = await importActual();
	return {
		...actual,
		limits: {
			...actual.limits,
			mcp3dGenerate: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })),
			mcp3dGenerateFree: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })),
		},
		clientIp: () => '203.0.113.9',
	};
});

const { default: handler } = await import('../../api/forge.js');

function makeReq(body) {
	return {
		method: 'POST',
		url: '/api/forge',
		headers: { 'content-type': 'application/json', 'x-forge-client': 'tester' },
		on(event, cb) {
			if (event === 'data') cb(Buffer.from(JSON.stringify(body)));
			if (event === 'end') cb();
		},
	};
}

function makeRes() {
	return {
		statusCode: 200,
		headers: {},
		body: null,
		setHeader(name, value) {
			this.headers[String(name).toLowerCase()] = value;
		},
		end(body) {
			this.body = body ? JSON.parse(body) : null;
		},
	};
}

const gateState = { gated: false };
vi.mock('../../api/_lib/forge-pixal3d-guard.js', async (importActual) => ({
	...(await importActual()),
	pixal3dLaneHealth: vi.fn(async () => ({ gated: gateState.gated, reason: 'Match my photo finished 2 of its last 11 jobs, so new photos are made with the standard engine until it recovers.' })),
}));

const body = { image_urls: ['https://cdn.example/front.png'], tier: 'standard', path: 'image', backend: 'pixal3d', skip_validation: true };

beforeEach(() => {
	gcpSubmit.mockClear();
});

describe('Match my photo health gate', () => {
	it('routes straight to the standard lane with the original photo when the lane is unhealthy', async () => {
		gateState.gated = true;
		const res = makeRes();
		await handler(makeReq(body), res);
		expect(res.statusCode).toBe(200);
		expect(res.body.backend).toBe('trellis_selfhost');
		expect(res.body.lane_fallback).toMatchObject({ from: 'pixal3d', to: 'trellis_selfhost' });
		expect(gcpSubmit.mock.calls[0][0].mode).toBe('trellis');
		expect(gcpSubmit.mock.calls[0][0].params.images).toEqual(body.image_urls);
	});
	it('uses pixal3d when the lane is healthy', async () => {
		gateState.gated = false;
		const res = makeRes();
		await handler(makeReq(body), res);
		expect(res.body.backend).toBe('pixal3d');
		expect(res.body.lane_fallback).toBeUndefined();
		expect(gcpSubmit.mock.calls[0][0].mode).toBe('pixal3d');
	});
});
