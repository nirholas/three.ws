/**
 * Request-boundary contract for AniGen's "rig on generate" lane on
 * api/forge.js: the request body the gcp provider receives (single image,
 * seed, no multi-view noise), and the happy path that must return a GLB job
 * recording the backend on the creation row.
 *
 * Modeled on tests/api/forge-pixal3d-request.test.js (same mocking shape).
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

beforeAll(() => {
	Object.assign(process.env, {
		APP_ORIGIN: 'https://three.ws',
		MODEL_ANIGEN_URL: 'https://anigen.example.run.app',
		MODEL_TRELLIS2_URL: 'https://trellis2.example.run.app',
		GCP_RECONSTRUCTION_KEY: 'test-gcp-key',
		NVIDIA_API_KEY: 'nvapi-test',
		JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
	});
});

const gcpSubmit = vi.fn(async ({ params }) => ({
	extJobId: 'gcpjob-anigen-01',
	viewsUsed: 1,
	multiview: false,
}));
vi.mock('../../api/_providers/gcp.js', () => ({
	createRegenProvider: () => ({ submit: gcpSubmit }),
}));

vi.mock('../../api/_mcp3d/text-to-image.js', () => ({
	textToImage: vi.fn(async () => ({ imageUrl: 'https://cdn.example/ref.png', model: 'flux' })),
	synthesizeTurnaroundViews: vi.fn(async () => []),
}));

const createCreation = vi.fn(async () => 'creation-anigen-1');
vi.mock('../../api/_lib/forge-store.js', () => ({
	hashClient: (v) => `client:${v || 'anon'}`,
	hashIp: (v) => `ip:${v}`,
	createCreation,
	materializeCreation: vi.fn(async ({ glbUrl }) => ({ id: 'creation-anigen-1', glbUrl })),
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

beforeEach(() => {
	gcpSubmit.mockClear();
	createCreation.mockClear();
});

describe('AniGen happy path', () => {
	it('a single-image request queues a job on the anigen backend', async () => {
		const req = makeReq({
			image_urls: ['https://cdn.example/front.png'],
			tier: 'standard',
			path: 'image',
			backend: 'anigen',
			skip_validation: true,
		});
		const res = makeRes();
		await handler(req, res);

		expect(res.statusCode).toBe(200);
		expect(res.body.backend).toBe('anigen');
		expect(res.body.status).toBe('queued');

		expect(gcpSubmit).toHaveBeenCalledTimes(1);
		const submitted = gcpSubmit.mock.calls[0][0];
		expect(submitted.mode).toBe('anigen');
		expect(submitted.params.images).toEqual(['https://cdn.example/front.png']);
		// No pixal3d-only fields leak into the anigen request shape.
		expect(submitted.params).not.toHaveProperty('view_labels');
		expect(submitted.params).not.toHaveProperty('fill_other_sides');
		expect(submitted.params).not.toHaveProperty('resolution');

		expect(createCreation).toHaveBeenCalledTimes(1);
		const creation = createCreation.mock.calls[0][0];
		expect(creation.backend).toBe('anigen');
		expect(creation.viewsRequested).toBe(1);
		expect(creation.viewsUsed).toBe(1);
		expect(creation.multiview).toBe(false);
	});

	it('an explicit seed rides through to the worker body', async () => {
		const req = makeReq({
			image_urls: ['https://cdn.example/front.png'],
			tier: 'standard',
			path: 'image',
			backend: 'anigen',
			seed: 123,
			skip_validation: true,
		});
		const res = makeRes();
		await handler(req, res);

		expect(res.statusCode).toBe(200);
		expect(gcpSubmit.mock.calls[0][0].params.seed).toBe(123);
	});

	it('extra views beyond the first are still forwarded (the worker reads only the first)', async () => {
		const req = makeReq({
			image_urls: ['https://cdn.example/front.png', 'https://cdn.example/back.png'],
			tier: 'standard',
			path: 'image',
			backend: 'anigen',
			skip_validation: true,
		});
		const res = makeRes();
		await handler(req, res);

		expect(res.statusCode).toBe(200);
		expect(gcpSubmit.mock.calls[0][0].params.images).toHaveLength(2);
	});
});

describe('AniGen unconfigured deployment', () => {
	it('returns a branchable 501 when MODEL_ANIGEN_URL is not set', async () => {
		const prev = process.env.MODEL_ANIGEN_URL;
		delete process.env.MODEL_ANIGEN_URL;
		try {
			gcpSubmit.mockRejectedValueOnce(Object.assign(new Error('no url'), { code: 'mode_unconfigured' }));
			const req = makeReq({
				image_urls: ['https://cdn.example/front.png'],
				tier: 'standard',
				path: 'image',
				backend: 'anigen',
				skip_validation: true,
			});
			const res = makeRes();
			await handler(req, res);
			expect(res.statusCode).toBe(501);
			expect(res.body.error).toBe('backend_unconfigured');
			expect(res.body.backend).toBe('anigen');
		} finally {
			if (prev !== undefined) process.env.MODEL_ANIGEN_URL = prev;
		}
	});
});
