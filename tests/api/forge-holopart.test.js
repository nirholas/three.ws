/**
 * Tests for the hidden-part completion endpoint (api/forge-holopart.js).
 *
 * The HoloPart worker is stubbed at the provider boundary (createRegenProvider
 * from api/_providers/gcp.js), so this exercises the endpoint's own logic:
 * mesh_url validation (SSRF, FBX rejection), the async submit/poll job shape,
 * and the parts/part_count/manifest_url passthrough Restyle Studio's
 * "Regenerate part" flow reads. HoloPart's own mesh completion is covered by
 * the worker's own Python tests.
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

const submit = vi.fn(async () => ({ extJobId: `task-holopart-${'x'.repeat(20)}`, eta: 60 }));
const status = vi.fn(async () => ({
	status: 'done',
	resultGlbUrl: 'https://storage.googleapis.com/bucket/holopart/task.glb',
	manifestUrl: 'https://storage.googleapis.com/bucket/holopart/task.manifest.json',
	parts: [{ id: 'part_01', name: 'part_01' }, { id: 'part_02', name: 'part_02' }],
	partCount: 2,
}));
let supportsHolopart = true;
let supportsSegment = true;

vi.mock('../../api/_providers/gcp.js', () => ({
	createRegenProvider: () => ({
		supportsMode: (m) => (m === 'holopart' && supportsHolopart) || (m === 'segment' && supportsSegment),
		submit,
		status,
	}),
}));

// Stub SSRF so no DNS resolution happens in tests; passthrough public https URLs.
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

const { default: handler } = await import('../../api/forge-holopart.js');

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

function makeReq({ method = 'POST', url = '/api/forge-holopart', headers = {}, body = null } = {}) {
	const payload = body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body);
	const stream = Readable.from(payload ? [Buffer.from(payload, 'utf8')] : []);
	stream.method = method;
	stream.url = url;
	stream.headers = {
		'content-type': 'application/json',
		'x-forwarded-for': '203.0.113.9',
		...headers,
	};
	return stream;
}

const MESH = 'https://storage.googleapis.com/bucket/segment/part_02.glb';

beforeEach(() => {
	submit.mockClear();
	status.mockClear();
	supportsHolopart = true;
	supportsSegment = true;
	submit.mockImplementation(async () => ({ extJobId: `task-holopart-${'x'.repeat(20)}`, eta: 60 }));
});

describe('POST /api/forge-holopart', () => {
	it('queues a holopart job against the already part-segmented mesh', async () => {
		const res = makeRes();
		await handler(makeReq({ body: { mesh_url: MESH, seed: 7 } }), res);
		expect(res.statusCode).toBe(202);
		const body = JSON.parse(res.body);
		expect(body.status).toBe('queued');
		expect(typeof body.job_id).toBe('string');
		expect(body.eta_seconds).toBe(60);

		expect(submit).toHaveBeenCalledTimes(1);
		const call = submit.mock.calls[0][0];
		expect(call.mode).toBe('holopart');
		expect(call.sourceUrl).toBe(MESH);
		expect(call.params.seed).toBe(7);
	});

	it('rejects a non-public mesh_url before calling the worker', async () => {
		const res = makeRes();
		await handler(makeReq({ body: { mesh_url: 'http://169.254.169.254/latest/meta-data/' } }), res);
		expect(res.statusCode).toBe(400);
		expect(JSON.parse(res.body).error).toBe('invalid_mesh_url');
		expect(submit).not.toHaveBeenCalled();
	});

	it('rejects an FBX mesh_url with the same unsupported-format message as segment', async () => {
		const res = makeRes();
		await handler(makeReq({ body: { mesh_url: 'https://storage.googleapis.com/bucket/character.fbx' } }), res);
		expect(res.statusCode).toBe(400);
		const body = JSON.parse(res.body);
		expect(body.error).toBe('unsupported_mesh_format');
		expect(body.message).toMatch(/holopart/);
		expect(submit).not.toHaveBeenCalled();
	});

	it('rejects a negative or non-integer seed', async () => {
		const res = makeRes();
		await handler(makeReq({ body: { mesh_url: MESH, seed: -1 } }), res);
		expect(res.statusCode).toBe(400);
		expect(JSON.parse(res.body).error).toBe('invalid_seed');
		expect(submit).not.toHaveBeenCalled();
	});

	it('answers 503 worker_unconfigured when MODEL_HOLOPART_URL is not set, not a generic failure', async () => {
		supportsHolopart = false;
		const res = makeRes();
		await handler(makeReq({ body: { mesh_url: MESH } }), res);
		expect(res.statusCode).toBe(503);
		expect(JSON.parse(res.body).error).toBe('unconfigured');
		expect(submit).not.toHaveBeenCalled();
	});
});

describe('heavy to light: HoloPart down falls back to the segment worker', () => {
	it('splits with the segment worker and says why when HoloPart is not deployed', async () => {
		supportsHolopart = false;
		submit.mockImplementation(async ({ mode }) => ({ extJobId: `task-${mode}-${'y'.repeat(20)}`, eta: 5 }));
		const res = makeRes();
		await handler(makeReq({ body: { mesh_url: MESH, fallback: 'segment' } }), res);
		expect(res.statusCode).toBe(202);
		const body = JSON.parse(res.body);
		expect(submit).toHaveBeenCalledTimes(1);
		const call = submit.mock.calls[0][0];
		expect(call.mode).toBe('segment');
		expect(call.sourceUrl).toBe(MESH);
		expect(call.params.method).toBe('connected');
		expect(body.job_id).toBe(`task-segment-${'y'.repeat(20)}`);
		expect(body.fallback).toEqual({ from: 'holopart', to: 'segment', reason: 'unconfigured', note: expect.any(String) });
		expect(body.fallback.note).toMatch(/HoloPart/);
		expect(body.fallback.note).toMatch(/hidden/i);
	});

	it('falls back when the HoloPart worker refuses the job, and only after trying it', async () => {
		submit.mockImplementation(async ({ mode }) => {
			if (mode === 'holopart') throw new Error('worker 503: no instance');
			return { extJobId: `task-${mode}-${'y'.repeat(20)}`, eta: 5 };
		});
		const res = makeRes();
		await handler(makeReq({ body: { mesh_url: MESH, fallback: 'segment' } }), res);
		expect(res.statusCode).toBe(202);
		expect(submit.mock.calls.map((c) => c[0].mode)).toEqual(['holopart', 'segment']);
		const body = JSON.parse(res.body);
		expect(body.fallback.reason).toBe('unavailable');
	});

	it('does not fall back unless the caller asked for it (Restyle regenerate needs real completion)', async () => {
		supportsHolopart = false;
		const res = makeRes();
		await handler(makeReq({ body: { mesh_url: MESH } }), res);
		expect(res.statusCode).toBe(503);
		expect(submit).not.toHaveBeenCalled();
	});

	it('still answers 503 when neither worker is deployed', async () => {
		supportsHolopart = false;
		supportsSegment = false;
		const res = makeRes();
		await handler(makeReq({ body: { mesh_url: MESH, fallback: 'segment' } }), res);
		expect(res.statusCode).toBe(503);
		expect(JSON.parse(res.body).error).toBe('unconfigured');
		expect(submit).not.toHaveBeenCalled();
	});

	it('the poll relays single_part, note and warnings from a segment fallback job', async () => {
		status.mockImplementationOnce(async () => ({
			status: 'done',
			resultGlbUrl: 'https://storage.googleapis.com/bucket/segment/t.glb',
			manifestUrl: 'https://storage.googleapis.com/bucket/segment/t.parts.json',
			parts: [{ id: 'part_01' }],
			partCount: 1,
			singlePart: true,
			note: 'one continuous surface',
			warnings: ['capped'],
		}));
		const res = makeRes();
		await handler(makeReq({ method: 'GET', url: `/api/forge-holopart?job=task-segment-${'y'.repeat(20)}` }), res);
		const body = JSON.parse(res.body);
		expect(body.single_part).toBe(true);
		expect(body.note).toBe('one continuous surface');
		expect(body.warnings).toEqual(['capped']);
	});
});

describe('GET /api/forge-holopart?job=<id>', () => {
	it('polls the job and surfaces the parts manifest fields for Restyle Studio', async () => {
		const jobId = `task-holopart-${'x'.repeat(20)}`;
		const res = makeRes();
		await handler(makeReq({ method: 'GET', url: `/api/forge-holopart?job=${jobId}` }), res);
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body.job_id).toBe(jobId);
		expect(body.status).toBe('done');
		expect(body.result_url).toBe('https://storage.googleapis.com/bucket/holopart/task.glb');
		expect(body.manifest_url).toBe('https://storage.googleapis.com/bucket/holopart/task.manifest.json');
		expect(body.parts).toEqual([{ id: 'part_01', name: 'part_01' }, { id: 'part_02', name: 'part_02' }]);
		expect(body.part_count).toBe(2);
	});

	it('rejects a malformed job id before calling the provider', async () => {
		const res = makeRes();
		await handler(makeReq({ method: 'GET', url: '/api/forge-holopart?job=short' }), res);
		expect(res.statusCode).toBe(400);
		expect(JSON.parse(res.body).error).toBe('invalid_job');
		expect(status).not.toHaveBeenCalled();
	});

	it('requires a job id', async () => {
		const res = makeRes();
		await handler(makeReq({ method: 'GET', url: '/api/forge-holopart' }), res);
		expect(res.statusCode).toBe(400);
		expect(JSON.parse(res.body).error).toBe('missing_job');
	});
});
