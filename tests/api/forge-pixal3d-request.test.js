/**
 * Request-boundary contract for Pixal3D's "Match my photo" lane on api/forge.js:
 * the 1-4 image cap (tighter than the generic MAX_VIEWS=6), the view_labels
 * length check, the fill_other_sides single-image check, and the happy path
 * that must return a GLB job and record every input URL on the creation row.
 *
 * Modeled on tests/api/forge-multiview-photo.test.js (same mocking shape).
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

beforeAll(() => {
	Object.assign(process.env, {
		APP_ORIGIN: 'https://three.ws',
		MODEL_PIXAL3D_URL: 'https://pixal3d.example.run.app',
		MODEL_TRELLIS2_URL: 'https://trellis2.example.run.app',
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

const PHOTOS = [
	'https://cdn.example/front.png',
	'https://cdn.example/back.png',
	'https://cdn.example/left.png',
];

beforeEach(() => {
	gcpSubmit.mockClear();
	createCreation.mockClear();
});

describe('Pixal3D request boundary: image count', () => {
	it('rejects a 5-image request (lane cap is 4, tighter than the generic 6)', async () => {
		const req = makeReq({
			image_urls: [...PHOTOS, 'https://cdn.example/right.png', 'https://cdn.example/extra.png'],
			tier: 'standard',
			path: 'image',
			backend: 'pixal3d',
			skip_validation: true,
		});
		const res = makeRes();
		await handler(req, res);
		expect(res.statusCode).toBe(400);
		expect(res.body.error).toBe('invalid_image_urls');
		expect(gcpSubmit).not.toHaveBeenCalled();
	});

	it('a 5-image request on trellis2 (within the generic 6-image cap) is unaffected by the pixal3d-only check', async () => {
		const req = makeReq({
			image_urls: [...PHOTOS, 'https://cdn.example/right.png', 'https://cdn.example/extra.png'],
			tier: 'standard',
			path: 'image',
			backend: 'trellis2',
			skip_validation: true,
		});
		const res = makeRes();
		await handler(req, res);
		expect(res.statusCode).toBe(200);
		expect(gcpSubmit).toHaveBeenCalledTimes(1);
		expect(gcpSubmit.mock.calls[0][0].params.images).toHaveLength(5);
	});
});

describe('Pixal3D request boundary: view_labels', () => {
	it('rejects a view_labels array whose length does not match the image count', async () => {
		const req = makeReq({
			image_urls: PHOTOS,
			view_labels: ['front', 'back'],
			tier: 'standard',
			path: 'image',
			backend: 'pixal3d',
			skip_validation: true,
		});
		const res = makeRes();
		await handler(req, res);
		expect(res.statusCode).toBe(400);
		expect(res.body.error).toBe('invalid_view_labels');
		expect(gcpSubmit).not.toHaveBeenCalled();
	});
});

describe('Pixal3D request boundary: fill_other_sides', () => {
	it('rejects fill_other_sides when more than one image is supplied', async () => {
		const req = makeReq({
			image_urls: PHOTOS,
			fill_other_sides: true,
			tier: 'standard',
			path: 'image',
			backend: 'pixal3d',
			skip_validation: true,
		});
		const res = makeRes();
		await handler(req, res);
		expect(res.statusCode).toBe(400);
		expect(res.body.error).toBe('invalid_fill_other_sides');
		expect(gcpSubmit).not.toHaveBeenCalled();
	});

	it('accepts fill_other_sides with exactly one image', async () => {
		const req = makeReq({
			image_urls: [PHOTOS[0]],
			fill_other_sides: true,
			tier: 'standard',
			path: 'image',
			backend: 'pixal3d',
			skip_validation: true,
		});
		const res = makeRes();
		await handler(req, res);
		expect(res.statusCode).toBe(200);
		expect(gcpSubmit.mock.calls[0][0].params.fill_other_sides).toBe(true);
	});
});

describe('Pixal3D happy path: multi-image request', () => {
	it('a 3-image request queues a job and records every input URL on the creation row', async () => {
		const req = makeReq({
			image_urls: PHOTOS,
			view_labels: ['front', 'back', 'left'],
			tier: 'standard',
			path: 'image',
			backend: 'pixal3d',
			skip_validation: true,
		});
		const res = makeRes();
		await handler(req, res);

		expect(res.statusCode).toBe(200);
		expect(res.body.backend).toBe('pixal3d');
		expect(res.body.status).toBe('queued');

		expect(gcpSubmit).toHaveBeenCalledTimes(1);
		const submitted = gcpSubmit.mock.calls[0][0];
		expect(submitted.mode).toBe('pixal3d');
		expect(submitted.params.images).toEqual(PHOTOS);
		expect(submitted.params.view_labels).toEqual(['front', 'back', 'left']);

		expect(createCreation).toHaveBeenCalledTimes(1);
		const creation = createCreation.mock.calls[0][0];
		expect(creation.sourceImageUrls).toEqual(PHOTOS);
		expect(creation.viewsRequested).toBe(3);
		expect(creation.viewsUsed).toBe(3);
		expect(creation.multiview).toBe(true);
		expect(creation.backend).toBe('pixal3d');
	});

	it('a single-image pixal3d request stays a single-view job (byte-for-byte path, no synthesis noise)', async () => {
		const req = makeReq({
			image_urls: [PHOTOS[0]],
			tier: 'standard',
			path: 'image',
			backend: 'pixal3d',
			skip_validation: true,
		});
		const res = makeRes();
		await handler(req, res);

		expect(res.statusCode).toBe(200);
		expect(gcpSubmit.mock.calls[0][0].params.images).toEqual([PHOTOS[0]]);
		const creation = createCreation.mock.calls[0][0];
		expect(creation.viewsRequested).toBe(1);
		expect(creation.viewsUsed).toBe(1);
		expect(creation.multiview).toBe(false);
	});
});
