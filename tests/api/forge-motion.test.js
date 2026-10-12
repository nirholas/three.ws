/**
 * Tests for the text→animation endpoint (api/forge-motion.js).
 *
 * The GPU motion worker is stubbed at the provider boundary (createRegenProvider
 * from api/_providers/gcp.js), so this exercises the endpoint's own logic:
 * validation, the queued-job submit, and the poll shape that surfaces the
 * retargetable AnimationClip URL. The worker's diffusion + SMPL→clip conversion
 * are covered by the worker's own Python tests.
 */

import { describe, it, expect, vi } from 'vitest';
import { Readable } from 'node:stream';

// Stub the GCP provider so no real Cloud Run service is needed.
const submit = vi.fn(async () => ({ extJobId: 'a'.repeat(24), eta: 30 }));
const status = vi.fn(async () => ({
	status: 'done',
	resultClipUrl: 'https://storage.googleapis.com/bucket/motion-clips/mdm/x.json',
	frames: 120,
	fps: 30,
}));
let supportsText2Motion = true;

vi.mock('../../api/_providers/gcp.js', () => ({
	createRegenProvider: () => ({
		supportsMode: (m) => m === 'text2motion' && supportsText2Motion,
		submit,
		status,
	}),
}));

// The worker's clip, as the lane writes it: every bone at the source rest
// (identity) except the neck, which turns HumanML3D's "head forward" into "up".
const SOURCE_BONES = [
	'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
	'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
	'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
	'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
	'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
];
const workerClip = () => {
	const times = [0, 1 / 30, 2 / 30];
	const neck = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];
	return {
		name: 'waving',
		duration: 2 / 30,
		tracks: [
			...SOURCE_BONES.map((bone) => ({
				type: 'quaternion',
				name: `${bone}.quaternion`,
				times,
				values: times.flatMap(() => (bone === 'Neck' ? neck : [0, 0, 0, 1])),
			})),
			{ type: 'vector', name: 'Hips.position', times, values: times.flatMap(() => [0, 0.98, 0]) },
		],
	};
};
let clipFetchFails = false;
vi.mock('../../api/_lib/upstream-fetch.js', () => ({
	fetchUpstream: vi.fn(async () => {
		if (clipFetchFails) throw new Error('storage unreachable');
		return { ok: true, json: async () => workerClip() };
	}),
}));

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

const { default: handler } = await import('../../api/forge-motion.js');

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

function makeReq({ method = 'POST', url = '/api/forge-motion', headers = {}, body = null } = {}) {
	const payload = body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body);
	const stream = Readable.from(payload ? [Buffer.from(payload, 'utf8')] : []);
	stream.method = method;
	stream.url = url;
	stream.headers = { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9', ...headers };
	return stream;
}

describe('POST /api/forge-motion', () => {
	it('accepts a prompt and returns a queued job', async () => {
		const res = makeRes();
		await handler(makeReq({ body: { prompt: 'waving confidently', duration_seconds: 5 } }), res);
		expect(res.statusCode).toBe(202);
		const body = JSON.parse(res.body);
		expect(body.job_id).toBe('a'.repeat(24));
		expect(body.status).toBe('queued');
		expect(body.eta_seconds).toBe(30);
		// The provider received the clamped duration + prompt.
		expect(submit).toHaveBeenCalledWith(
			expect.objectContaining({ mode: 'text2motion', params: expect.objectContaining({ prompt: 'waving confidently' }) }),
		);
	});

	it('clamps an over-long duration to the 10s cap', async () => {
		const res = makeRes();
		await handler(makeReq({ body: { prompt: 'a long dance', duration_seconds: 99 } }), res);
		expect(res.statusCode).toBe(202);
		const call = submit.mock.calls.at(-1)[0];
		expect(call.params.duration_seconds).toBe(10);
	});

	it('rejects a too-short prompt', async () => {
		const res = makeRes();
		await handler(makeReq({ body: { prompt: 'x' } }), res);
		expect(res.statusCode).toBe(400);
		expect(JSON.parse(res.body).error).toBe('invalid_prompt');
	});

	it('503s when the worker is not configured', async () => {
		supportsText2Motion = false;
		const res = makeRes();
		await handler(makeReq({ body: { prompt: 'a graceful bow' } }), res);
		expect(res.statusCode).toBe(503);
		expect(JSON.parse(res.body).error).toBe('unconfigured');
		supportsText2Motion = true;
	});
});

describe('GET /api/forge-motion?job=', () => {
	it('returns the retargetable clip URL when done', async () => {
		const res = makeRes();
		await handler(makeReq({ method: 'GET', url: `/api/forge-motion?job=${'a'.repeat(24)}` }), res);
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body.status).toBe('done');
		expect(body.clip_url).toMatch(/motion-clips\/mdm/);
		expect(body.frames).toBe(120);
		expect(body.fps).toBe(30);
	});

	it('hands back the clip already converted to the library basis', async () => {
		const res = makeRes();
		await handler(makeReq({ method: 'GET', url: `/api/forge-motion?job=${'a'.repeat(24)}` }), res);
		const body = JSON.parse(res.body);
		// userData has to be a JSON string here, not an object: the client runs
		// this clip straight through three.js's AnimationClip.parse(), which
		// hands userData to JSON.parse() unchanged.
		expect(typeof body.clip.userData).toBe('string');
		expect(JSON.parse(body.clip.userData).basis).toBe('canonical-rest-v2');
		const { forwardKinematicsFrame } = await import('../../api/_lib/motion-seed.js');
		const w = forwardKinematicsFrame(body.clip, 0);
		// Head over the neck and arms hanging, not thrown back and raised.
		expect(w.Head[1] - w.Neck[1]).toBeGreaterThan(0.1);
		expect(w.LeftArm[1] - w.LeftHand[1]).toBeGreaterThan(0.4);
	});

	it('falls back to the raw clip URL when the conversion cannot run', async () => {
		clipFetchFails = true;
		try {
			const res = makeRes();
			await handler(makeReq({ method: 'GET', url: `/api/forge-motion?job=${'a'.repeat(24)}` }), res);
			const body = JSON.parse(res.body);
			expect(res.statusCode).toBe(200);
			expect(body.clip).toBeNull();
			expect(body.clip_url).toMatch(/motion-clips\/mdm/);
		} finally {
			clipFetchFails = false;
		}
	});

	it('400s without a job id', async () => {
		const res = makeRes();
		await handler(makeReq({ method: 'GET', url: '/api/forge-motion' }), res);
		expect(res.statusCode).toBe(400);
		expect(JSON.parse(res.body).error).toBe('missing_job');
	});

	it('400s on a malformed job id', async () => {
		const res = makeRes();
		await handler(makeReq({ method: 'GET', url: '/api/forge-motion?job=short' }), res);
		expect(res.statusCode).toBe(400);
		expect(JSON.parse(res.body).error).toBe('invalid_job');
	});
});
