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

// Making or uploading needs an account (api/_lib/creator-account.js). These
// cases exercise what happens past that gate, so the caller is signed in. The
// gate itself has its own suite in tests/creation-endpoints-auth.test.js.
vi.mock('../../api/_lib/auth.js', async (orig) => ({
	...(await orig()),
	getRequestUser: async () => ({ id: 'creator-test-user' }),
}));

const submit = vi.fn(async () => ({ extJobId: `task-sam3d-${'x'.repeat(20)}`, eta: 150 }));
const status = vi.fn(async () => ({
	status: 'done',
	resultGlbUrl: 'https://storage.googleapis.com/bucket/sam3d/task.glb',
	objects: [{ id: 'object_01', name: 'object_01', input_index: 0, bbox: { min: [-0.5, 0, -3.5], max: [0.5, 1, -2.5] }, centroid: [0, 0.5, -3] }],
	objectCount: 1,
	leveling: { applied: true, tilt_deg: 28.4, up: [0, 0.88, 0.47] },
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
vi.mock('../../api/_lib/vision.js', async (importOriginal) => ({
	VISION_TASK_LEAD: (await importOriginal()).VISION_TASK_LEAD,
	describeImageJson: (...a) => detect(...a),
}));

vi.mock('../../api/_lib/ssrf.js', async (importOriginal) => {
	const mod = await importOriginal();
	return {
		...mod,
		assertPublicHttpsUrl: vi.fn(async (url) => {
			const parsed = new URL(url);
			if (parsed.protocol !== 'https:') throw new mod.SsrfError('https required');
			// IP literals and localhost resolve without the network, so they go
			// through the real guard: that is the case this suite pins.
			if (/^(\d|\[)|^localhost$/i.test(parsed.hostname)) return mod.assertPublicHttpsUrl(url);
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
			mcp3dGenerateRefund: vi.fn(async () => undefined),
		},
	};
});

const { default: handler } = await import('../../api/forge-scene-objects.js');
const { limits } = await import('../../api/_lib/rate-limit.js');

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
	limits.mcp3dGenerate.mockClear();
	limits.mcp3dGenerateRefund.mockClear();
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

	});

	it('reports a photo with nothing in it as a clean "nothing found", not an error, and gives the allowance back', async () => {
		detect.mockResolvedValue({ json: { objects: [] } });
		const res = makeRes();
		await handler(makeReq({ body: { image_url: PHOTO } }), res);
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body).toMatchObject({ status: 'empty', job_id: null, error: null, error_code: 'nothing_found', objects: [] });
		expect(body.message).toMatch(/nothing found to lift out of this photo/i);
		expect(submit).not.toHaveBeenCalled();
		expect(limits.mcp3dGenerateRefund).toHaveBeenCalledTimes(1);
	});

	it.each([
		['loopback', 'https://127.0.0.1/room.jpg'],
		['localhost', 'https://localhost/room.jpg'],
		['private network', 'https://10.0.0.7/room.jpg'],
		['cloud metadata', 'https://169.254.169.254/latest/meta-data'],
	])('refuses a %s image address before any work', async (_label, url) => {
		const res = makeRes();
		await handler(makeReq({ body: { image_url: url, boxes: [[0.1, 0.1, 0.4, 0.5]] } }), res);
		expect(res.statusCode).toBe(400);
		const body = JSON.parse(res.body);
		expect(body.error).toBe('invalid_image_url');
		expect(body.message).toMatch(/private|rejected/i);
		expect(submit).not.toHaveBeenCalled();
		expect(detect).not.toHaveBeenCalled();
	});

	it('does not spend the allowance on a request it refuses as invalid', async () => {
		const res = makeRes();
		await handler(makeReq({ body: { image_url: PHOTO, boxes: [[0.5, 0.5, 0.4, 0.4]] } }), res);
		expect(res.statusCode).toBe(400);
		expect(limits.mcp3dGenerate).not.toHaveBeenCalled();
	});

	it('does not spend the allowance while the worker is not configured', async () => {
		supportsSam3d = false;
		const res = makeRes();
		await handler(makeReq({ body: { image_url: PHOTO, boxes: [[0.1, 0.1, 0.4, 0.5]] } }), res);
		expect(res.statusCode).toBe(503);
		expect(limits.mcp3dGenerate).not.toHaveBeenCalled();
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
		expect(body.objects).toEqual([{ id: 'object_01', name: 'object_01', input_index: 0, bbox: { min: [-0.5, 0, -3.5], max: [0.5, 1, -2.5] }, centroid: [0, 0.5, -3] }]);
		expect(body.object_count).toBe(1);
		expect(body.leveling).toEqual({ applied: true, tilt_deg: 28.4, up: [0, 0.88, 0.47] });
	});

	const poll = async (jobId) => {
		const res = makeRes();
		await handler(makeReq({ method: 'GET', url: `/api/forge-scene-objects?job=${jobId}` }), res);
		return { statusCode: res.statusCode, body: JSON.parse(res.body) };
	};
	const goodObject = (n) => ({
		id: `object_0${n}`, name: `object_0${n}`, input_index: n - 1,
		bbox: { min: [n - 1, 0, -1], max: [n, 1, 0] }, centroid: [n - 0.5, 0.5, -0.5], size: [1, 1, 1],
	});

	it('keeps a job alive while a cold worker misses a poll, and says it is waking', async () => {
		status.mockResolvedValueOnce({ status: 'running', error: 'poll failed: upstream timeout after 15000ms' });
		const { body } = await poll(`task-sam3d-cold-${'c'.repeat(20)}`);
		expect(body.status).toBe('running');
		expect(body.error).toBeNull();
		expect(body.waking).toBe(true);
		expect(limits.mcp3dGenerateRefund).not.toHaveBeenCalled();
	});

	it.each([
		['out_of_memory', 'no object could be reconstructed (CUDA out of memory. Tried to allocate 2.00 GiB)', /ran out of memory/i, true],
		['worker_cold', 'pipeline not ready (model load timed out)', /still starting/i, true],
		['worker_unavailable', 'pipeline unavailable: model load error (ref 9f)', /could not load/i, true],
		['timeout', 'object reconstruction timed out after 600s', /took too long/i, true],
		['bad_photo', 'photo is not a readable image (use PNG, JPEG or WebP)', /could not read that photo/i, false],
		['worker_error', 'internal error (ref 0a1b2c3d4e5f)', /ref 0a1b2c3d4e5f/, true],
	])('maps a worker failure to %s with a clear message and a retry hint', async (code, raw, message, retryable) => {
		status.mockResolvedValueOnce({ status: 'failed', error: raw });
		const { body } = await poll(`task-sam3d-${code}-${'f'.repeat(20)}`);
		expect(body.status).toBe('failed');
		expect(body.error_code).toBe(code);
		expect(body.error).toMatch(message);
		expect(body.error).not.toMatch(/CUDA|Tried to allocate/);
		expect(body.retryable).toBe(retryable);
	});

	it('reports a worker that lifted nothing out of the photo as a clean "nothing found"', async () => {
		status.mockResolvedValueOnce({
			status: 'failed',
			error: 'no object could be reconstructed (the model returned no mesh for this object; the model returned no mesh for this object)',
		});
		const { body } = await poll(`task-sam3d-empty-${'e'.repeat(20)}`);
		expect(body.status).toBe('empty');
		expect(body.error).toBeNull();
		expect(body.error_code).toBe('nothing_found');
		expect(body.message).toMatch(/nothing found to lift out of this photo/i);
	});

	it('reports a finished scene with no objects as "nothing found"', async () => {
		status.mockResolvedValueOnce({ status: 'done', resultGlbUrl: 'https://storage.googleapis.com/b/s.glb', objects: [], objectCount: 0 });
		const { body } = await poll(`task-sam3d-zero-${'z'.repeat(20)}`);
		expect(body.status).toBe('empty');
		expect(body.result_url).toBeNull();
		expect(body.error_code).toBe('nothing_found');
	});

	it('checks a finished scene before handing it over', async () => {
		const bad = { ...goodObject(3), centroid: [Number.NaN, 0, 0] };
		status.mockResolvedValueOnce({
			status: 'done', resultGlbUrl: 'https://storage.googleapis.com/b/s.glb',
			objects: [goodObject(1), goodObject(2), bad, { name: '../../etc' }], objectCount: 4,
		});
		const { body } = await poll(`task-sam3d-check-${'k'.repeat(20)}`);
		expect(body.status).toBe('done');
		expect(body.objects.map((o) => o.name)).toEqual(['object_01', 'object_02']);
		expect(body.object_count).toBe(2);
	});

	it.each([
		['a result that is not a public https file', { status: 'done', resultGlbUrl: '/results/x.glb', objects: [goodObject(1)], objectCount: 1 }],
		['a manifest with no usable object', { status: 'done', resultGlbUrl: 'https://storage.googleapis.com/b/s.glb', objects: [{ name: 'object_01', centroid: ['x'] }], objectCount: 1 }],
		['more objects than the lane allows', { status: 'done', resultGlbUrl: 'https://storage.googleapis.com/b/s.glb', objects: Array.from({ length: 13 }, (_, i) => ({ ...goodObject(1), name: `object_${String(i + 1).padStart(2, '0')}` })), objectCount: 13 }],
	])('refuses %s as an unusable result', async (_label, result) => {
		status.mockResolvedValueOnce(result);
		const { body } = await poll(`task-sam3d-bad-${'b'.repeat(20)}`);
		expect(body.status).toBe('failed');
		expect(body.error_code).toBe('bad_result');
		expect(body.result_url).toBeNull();
		expect(body.retryable).toBe(true);
	});

	it('gives the allowance back once when a job it charged for fails on the worker', async () => {
		const jobId = `task-sam3d-refund-${'r'.repeat(20)}`;
		submit.mockResolvedValueOnce({ extJobId: jobId, eta: 150 });
		const start = makeRes();
		await handler(makeReq({ body: { image_url: PHOTO, boxes: [[0.1, 0.1, 0.4, 0.5]] } }), start);
		expect(start.statusCode).toBe(202);
		expect(limits.mcp3dGenerate).toHaveBeenCalledTimes(1);

		status
			.mockResolvedValueOnce({ status: 'failed', error: 'internal error (ref 0a1b2c3d4e5f)' })
			.mockResolvedValueOnce({ status: 'failed', error: 'internal error (ref 0a1b2c3d4e5f)' });
		await poll(jobId);
		await poll(jobId);
		expect(limits.mcp3dGenerateRefund).toHaveBeenCalledTimes(1);
		expect(limits.mcp3dGenerateRefund).toHaveBeenCalledWith('user:creator-test-user');
	});

	it('never refunds a job id it did not charge for', async () => {
		status.mockResolvedValueOnce({ status: 'failed', error: 'internal error (ref 0a1b2c3d4e5f)' });
		await poll(`task-sam3d-stranger-${'s'.repeat(20)}`);
		expect(limits.mcp3dGenerateRefund).not.toHaveBeenCalled();
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

describe('GET /api/forge-scene-objects?status', () => {
	it('says the lane is available once the worker is configured', async () => {
		const res = makeRes();
		await handler(makeReq({ method: 'GET', url: '/api/forge-scene-objects?status' }), res);
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body).toMatchObject({ available: true, reason: null, max_objects: 12, default_objects: 8 });
		expect(submit).not.toHaveBeenCalled();
		expect(status).not.toHaveBeenCalled();
	});

	it('answers 200 with a reason, not a 503, while the worker is off', async () => {
		supportsSam3d = false;
		const res = makeRes();
		await handler(makeReq({ method: 'GET', url: '/api/forge-scene-objects?status=1' }), res);
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body.available).toBe(false);
		expect(body.reason).toBe('backend_unconfigured');
		expect(body.message).toMatch(/not switched on/i);
	});

	it('tells a sanctioned jurisdiction up front instead of after an upload', async () => {
		const res = makeRes();
		await handler(makeReq({ method: 'GET', url: '/api/forge-scene-objects?status', headers: { 'x-client-geo-location': 'KP,Pyongyang' } }), res);
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body.available).toBe(false);
		expect(body.reason).toBe('unavailable_in_region');
	});
});
