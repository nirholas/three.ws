/**
 * Tests for the scene-from-a-photo endpoint (api/forge-scene-objects.js).
 *
 * The SAM 3D Objects worker and the vision chain are stubbed at their module
 * boundaries, so this exercises the endpoint's own logic: the sanctions guard,
 * SSRF checks, object selection (boxes, masks, automatic detection), the
 * backend_unconfigured answer, and the poll passthrough.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';

const submit = vi.fn(async () => ({ extJobId: `task-sam3d-${'x'.repeat(20)}`, eta: 150 }));
const status = vi.fn(async () => ({
	status: 'done',
	resultGlbUrl: 'https://storage.googleapis.com/bucket/sam3d/task.glb',
	objects: [{ id: 'object_01', centroid: [0, 0, -3] }],
	objectCount: 1,
}));
let supportsSam3d = true;

vi.mock('../../api/_providers/gcp.js', () => ({
	createRegenProvider: () => ({
		supportsMode: (m) => m === 'sam3d' && supportsSam3d,
		submit,
		status,
	}),
}));

const detect = vi.fn();
vi.mock('../../api/_lib/vision.js', () => ({
	describeImageJson: (...a) => detect(...a),
}));

vi.mock('../../api/_lib/ssrf.js', async (importOriginal) => {
	const mod = await importOriginal();
	return {
		...mod,
		assertPublicHttpsUrl: vi.fn(async (url) => {
			const parsed = new URL(url);
			if (parsed.protocol !== 'https:') throw new mod.SsrfError('https required');
			return url;
		}),
	};
});

vi.mock('../../api/_lib/rate-limit.js', async (importActual) => {
	const actual = await importActual();
	return {
		...actual,
		clientIp: () => '203.0.113.9',
		limits: {
			...actual.limits,
			mcp3dGenerate: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })),
			mcp3dStatus: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })),
		},
	};
});

const { default: handler } = await import('../../api/forge-scene-objects.js');

function makeRes() {
	return {
		statusCode: 200,
		headers: {},
		body: null,
		setHeader(n, v) {
			this.headers[String(n).toLowerCase()] = v;
		},
		end(b) {
			this.body = b ?? null;
		},
	};
}

function makeReq({ method = 'POST', url = '/api/forge-scene-objects', headers = {}, body = null } = {}) {
	const payload = body == null ? '' : JSON.stringify(body);
	const stream = Readable.from(payload ? [Buffer.from(payload, 'utf8')] : []);
	stream.method = method;
	stream.url = url;
	stream.headers = { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9', ...headers };
	return stream;
}

const PHOTO = 'https://storage.googleapis.com/bucket/room.jpg';

beforeEach(() => {
	submit.mockClear();
	status.mockClear();
	detect.mockReset();
	supportsSam3d = true;
});

describe('POST /api/forge-scene-objects', () => {
	it('queues a job with the caller\'s boxes in order', async () => {
		const res = makeRes();
		await handler(makeReq({ body: { image_url: PHOTO, boxes: [[0.1, 0.1, 0.4, 0.5], [0.6, 0.6, 0.9, 0.9]], seed: 3 } }), res);
		expect(res.statusCode).toBe(202);
		const body = JSON.parse(res.body);
		expect(body.source).toBe('boxes');
		expect(body.eta_seconds).toBe(150);
		const call = submit.mock.calls[0][0];
		expect(call.mode).toBe('sam3d');
		expect(call.sourceUrl).toBe(PHOTO);
		expect(call.params.boxes).toEqual([[0.1, 0.1, 0.4, 0.5], [0.6, 0.6, 0.9, 0.9]]);
		expect(call.params.seed).toBe(3);
		expect(detect).not.toHaveBeenCalled();
	});

	it('queues a job with mask URLs after the SSRF check', async () => {
		const res = makeRes();
		await handler(makeReq({ body: { image_url: PHOTO, mask_urls: ['https://storage.googleapis.com/bucket/m1.png'] } }), res);
		expect(res.statusCode).toBe(202);
		expect(JSON.parse(res.body).source).toBe('masks');
		expect(submit.mock.calls[0][0].params.maskUrls).toEqual(['https://storage.googleapis.com/bucket/m1.png']);
	});

	it('finds the objects itself when none are named', async () => {
		detect.mockResolvedValue({ json: { objects: [{ label: 'lamp', box_2d: [100, 100, 600, 400] }] } });
		const res = makeRes();
		await handler(makeReq({ body: { image_url: PHOTO } }), res);
		expect(res.statusCode).toBe(202);
		const body = JSON.parse(res.body);
		expect(body.source).toBe('detected');
		expect(body.objects).toEqual([{ label: 'lamp', box: [0.1, 0.1, 0.4, 0.6] }]);
		expect(submit.mock.calls[0][0].params.boxes).toEqual([[0.1, 0.1, 0.4, 0.6]]);
	});

	it('explains a vision outage and an empty photo instead of failing blind', async () => {
		detect.mockRejectedValue(new Error('no vision provider'));
		let res = makeRes();
		await handler(makeReq({ body: { image_url: PHOTO } }), res);
		expect(res.statusCode).toBe(502);
		expect(JSON.parse(res.body).error).toBe('detect_failed');

		detect.mockResolvedValue({ json: { objects: [] } });
		res = makeRes();
		await handler(makeReq({ body: { image_url: PHOTO } }), res);
		expect(res.statusCode).toBe(422);
		expect(JSON.parse(res.body).error).toBe('no_objects_found');
		expect(submit).not.toHaveBeenCalled();
	});

	it('turns away a comprehensively sanctioned jurisdiction before any work', async () => {
		const res = makeRes();
		await handler(makeReq({ headers: { 'x-client-geo-location': 'IR,Tehran' }, body: { image_url: PHOTO, boxes: [[0.1, 0.1, 0.4, 0.5]] } }), res);
		expect(res.statusCode).toBe(451);
		expect(JSON.parse(res.body).error).toBe('unavailable_in_region');
		expect(submit).not.toHaveBeenCalled();
	});

	it('does not block an unresolved country or an ordinary one', async () => {
		for (const headers of [{}, { 'x-client-geo-location': 'DE,Berlin' }]) {
			const res = makeRes();
			await handler(makeReq({ headers, body: { image_url: PHOTO, boxes: [[0.1, 0.1, 0.4, 0.5]] } }), res);
			expect(res.statusCode).toBe(202);
		}
	});

	it('answers 503 backend_unconfigured until the worker is set', async () => {
		supportsSam3d = false;
		const res = makeRes();
		await handler(makeReq({ body: { image_url: PHOTO, boxes: [[0.1, 0.1, 0.4, 0.5]] } }), res);
		expect(res.statusCode).toBe(503);
		expect(JSON.parse(res.body).error).toBe('backend_unconfigured');
		expect(submit).not.toHaveBeenCalled();
	});

	it.each([
		[{ image_url: 'http://169.254.169.254/x.jpg', boxes: [[0.1, 0.1, 0.4, 0.5]] }, 'invalid_image_url'],
		[{ image_url: PHOTO, mask_urls: ['http://10.0.0.1/m.png'] }, 'invalid_mask_urls'],
		[{ image_url: PHOTO, boxes: [[0.5, 0.5, 0.4, 0.4]] }, 'invalid_boxes'],
		[{ image_url: PHOTO, boxes: [[0.1, 0.1, 0.4, 0.5]], mask_urls: ['https://x.test/m.png'] }, 'ambiguous_objects'],
		[{ image_url: PHOTO, boxes: [[0.1, 0.1, 0.4, 0.5]], max_objects: 99 }, 'invalid_max_objects'],
		[{ image_url: PHOTO, boxes: [[0.1, 0.1, 0.4, 0.5]], seed: -2 }, 'invalid_seed'],
	])('rejects %j', async (body, error) => {
		const res = makeRes();
		await handler(makeReq({ body }), res);
		expect(res.statusCode).toBe(400);
		expect(JSON.parse(res.body).error).toBe(error);
		expect(submit).not.toHaveBeenCalled();
	});
});

describe('GET /api/forge-scene-objects?job=<id>', () => {
	it('polls the job and surfaces the object manifest', async () => {
		const jobId = `task-sam3d-${'x'.repeat(20)}`;
		const res = makeRes();
		await handler(makeReq({ method: 'GET', url: `/api/forge-scene-objects?job=${jobId}` }), res);
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body.status).toBe('done');
		expect(body.result_url).toBe('https://storage.googleapis.com/bucket/sam3d/task.glb');
		expect(body.objects).toEqual([{ id: 'object_01', centroid: [0, 0, -3] }]);
		expect(body.object_count).toBe(1);
	});

	it('rejects a malformed or missing job id', async () => {
		let res = makeRes();
		await handler(makeReq({ method: 'GET', url: '/api/forge-scene-objects?job=short' }), res);
		expect(JSON.parse(res.body).error).toBe('invalid_job');
		res = makeRes();
		await handler(makeReq({ method: 'GET', url: '/api/forge-scene-objects' }), res);
		expect(JSON.parse(res.body).error).toBe('missing_job');
		expect(status).not.toHaveBeenCalled();
	});
});
