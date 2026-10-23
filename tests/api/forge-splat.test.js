/**
 * Tests for the image-to-splat endpoint (api/forge-splat.js). The TripoSplat
 * worker is stubbed at the provider boundary, so this pins the endpoint's own
 * contract: image_url SSRF validation, density bounds, the async submit/poll
 * shape and the viewer deep link. The model itself is covered by the worker's
 * Python suite and a live run.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';

const submit = vi.fn(async () => ({ extJobId: `task-triposplat-${'x'.repeat(20)}`, eta: 45 }));
const status = vi.fn(async () => ({
	status: 'done',
	resultSplatUrl: 'https://storage.googleapis.com/bucket/raw-splats/triposplat/t.splat',
	plyUrl: 'https://storage.googleapis.com/bucket/raw-splats/triposplat/t.ply',
	numGaussians: 131072,
}));
let supported = true;

vi.mock('../../api/_providers/gcp.js', () => ({
	createRegenProvider: () => ({
		supportsMode: (m) => m === 'triposplat' && supported,
		submit,
		status,
	}),
}));

vi.mock('../../api/_lib/ssrf.js', async (importOriginal) => {
	const mod = await importOriginal();
	return {
		...mod,
		assertPublicHttpsUrl: vi.fn(async (url) => {
			if (new URL(url).protocol !== 'https:') throw new mod.SsrfError('https required');
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

const { default: handler, parseNumGaussians } = await import('../../api/forge-splat.js');

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

function makeReq({ method = 'POST', url = '/api/forge-splat', body = null } = {}) {
	const stream = Readable.from(body == null ? [] : [Buffer.from(JSON.stringify(body), 'utf8')]);
	stream.method = method;
	stream.url = url;
	stream.headers = { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' };
	return stream;
}

const IMAGE = 'https://example.com/house.webp';

beforeEach(() => {
	submit.mockClear();
	status.mockClear();
	supported = true;
});

describe('parseNumGaussians', () => {
	it('accepts absent and in-range integers, rejects the rest', () => {
		expect(parseNumGaussians(undefined)).toEqual({ value: undefined });
		expect(parseNumGaussians(262144)).toEqual({ value: 262144 });
		for (const bad of [0, 8191, 262145, 9000.5, '9000', true]) {
			expect(parseNumGaussians(bad).error).toMatch(/between 8192 and 262144/);
		}
	});
});

describe('POST /api/forge-splat', () => {
	it('queues a triposplat job for the image', async () => {
		const res = makeRes();
		await handler(makeReq({ body: { image_url: IMAGE, num_gaussians: 65536 } }), res);
		expect(res.statusCode).toBe(202);
		expect(JSON.parse(res.body)).toMatchObject({ status: 'queued', eta_seconds: 45 });
		const call = submit.mock.calls[0][0];
		expect(call.mode).toBe('triposplat');
		expect(call.sourceUrl).toBe(IMAGE);
		expect(call.params.num_gaussians).toBe(65536);
	});

	it('rejects a non-public image_url before calling the worker', async () => {
		const res = makeRes();
		await handler(makeReq({ body: { image_url: 'http://169.254.169.254/x.png' } }), res);
		expect(res.statusCode).toBe(400);
		expect(JSON.parse(res.body).error).toBe('invalid_image_url');
		expect(submit).not.toHaveBeenCalled();
	});

	it('rejects an out-of-range density', async () => {
		const res = makeRes();
		await handler(makeReq({ body: { image_url: IMAGE, num_gaussians: 5 } }), res);
		expect(res.statusCode).toBe(400);
		expect(JSON.parse(res.body).error).toBe('invalid_num_gaussians');
		expect(submit).not.toHaveBeenCalled();
	});

	it('answers 503 with setup guidance when the worker is not configured', async () => {
		supported = false;
		const res = makeRes();
		await handler(makeReq({ body: { image_url: IMAGE } }), res);
		expect(res.statusCode).toBe(503);
		expect(JSON.parse(res.body).message).toMatch(/MODEL_TRIPOSPLAT_URL/);
	});
});

describe('GET /api/forge-splat?job=', () => {
	it('returns the splat, ply and a viewer deep link when done', async () => {
		const res = makeRes();
		await handler(makeReq({ method: 'GET', url: `/api/forge-splat?job=${'a'.repeat(24)}` }), res);
		const body = JSON.parse(res.body);
		expect(res.statusCode).toBe(200);
		expect(body.status).toBe('done');
		expect(body.splat_url).toMatch(/\.splat$/);
		expect(body.ply_url).toMatch(/\.ply$/);
		expect(body.num_gaussians).toBe(131072);
		expect(body.viewer_url).toBe(`/splat?src=${encodeURIComponent(body.splat_url)}`);
	});

	it('rejects a missing or malformed job id', async () => {
		const a = makeRes();
		await handler(makeReq({ method: 'GET', url: '/api/forge-splat' }), a);
		expect(a.statusCode).toBe(400);
		const b = makeRes();
		await handler(makeReq({ method: 'GET', url: '/api/forge-splat?job=../etc' }), b);
		expect(b.statusCode).toBe(400);
		expect(status).not.toHaveBeenCalled();
	});
});
