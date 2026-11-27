/**
 * A sketch request whose scribble worker is down is served by an image lane.
 *
 * Before, POST /api/forge with path "sketch" and the scribble worker warming up
 * or erroring answered 503 "try again in a moment": the drawing was the only
 * input and the sketch worker the only lane that took it, so there was nothing
 * behind it. A drawing is still a picture, so the standard image lanes can build
 * it. These tests drive a real POST through the handler with the real gcp
 * provider and a recording fetch, so what is asserted is what goes on the wire:
 *
 *   - the scribble worker answers 503, the TRELLIS worker is asked for the
 *     drawing as its image, and the response is 200 with that lane and a note
 *     saying in words that the drawing is being treated as a picture;
 *   - the job is recorded as an image job on the lane that took it;
 *   - with no image lane left, the request still ends on the designed 503.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';

vi.mock('../../api/_lib/auth.js', async (orig) => ({
	...(await orig()),
	getRequestUser: async () => ({ id: 'forge-test-user' }),
}));

const createCreation = vi.fn(async () => 'creation-1');
vi.mock('../../api/_lib/forge-store.js', () => ({
	hashClient: (v) => `client:${v || 'anon'}`,
	hashIp: (v) => `ip:${v}`,
	createCreation: (...a) => createCreation(...a),
	materializeCreation: vi.fn(async ({ glbUrl }) => ({ id: 'creation-1', glbUrl })),
	markFailed: vi.fn(async () => {}),
	findByJob: vi.fn(async () => null),
	runWithCreationContext: (_facts, fn) => fn(),
}));

const markLaneUnhealthy = vi.fn(async () => {});
vi.mock('../../api/_lib/forge-lane-health.js', () => ({
	laneHealthSnapshot: vi.fn(async () => ({ statusMap: {}, byId: {} })),
	markLaneUnhealthy: (...a) => markLaneUnhealthy(...a),
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

const SKETCH_URL = 'https://three.ws.example/sketch-worker';
const TRELLIS_URL = 'https://trellis.example.run.app';
const DRAWING = 'https://cdn.example/sketch.png';

const ENV = {
	APP_ORIGIN: 'https://three.ws',
	GCP_TRIPOSG_URL: SKETCH_URL,
	MODEL_TRELLIS_URL: TRELLIS_URL,
	GCP_RECONSTRUCTION_KEY: 'test-gcp-key',
	JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
};
const CLEARED = ['MODEL_TRELLIS2_URL', 'GCP_HUNYUAN3D_URL', 'MODEL_MODLY_URL', 'MODEL_PIXAL3D_URL', 'HF_TOKEN'];
const saved = {};
const ORIGINAL_FETCH = globalThis.fetch;

beforeAll(() => {
	for (const k of [...Object.keys(ENV), ...CLEARED]) saved[k] = process.env[k];
	Object.assign(process.env, ENV);
	for (const k of CLEARED) delete process.env[k];
});

afterAll(() => {
	globalThis.fetch = ORIGINAL_FETCH;
	for (const [k, v] of Object.entries(saved)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
});

const { default: forgeHandler } = await import('../../api/forge.js');
const { default: gptForgeHandler } = await import('../../api/gpt-forge.js');

let requests = [];
let trellisUp = true;
function recordingFetch() {
	requests = [];
	globalThis.fetch = vi.fn(async (input, opts = {}) => {
		const url = String(input?.url || input);
		let body = null;
		try {
			body = opts.body ? JSON.parse(opts.body) : null;
		} catch {
			body = null;
		}
		requests.push({ url, method: opts.method || 'GET', body });
		if (url === `${SKETCH_URL}/infer`) return new Response('service unavailable', { status: 503 });
		if (url === `${TRELLIS_URL}/infer` && trellisUp) {
			return new Response(JSON.stringify({ task_id: 'task-trellis-1', status: 'queued' }), {
				status: 202,
				headers: { 'content-type': 'application/json' },
			});
		}
		if (url === `${TRELLIS_URL}/infer`) return new Response('service unavailable', { status: 503 });
		return new Response('not found', { status: 404 });
	});
}

function makeReq(url, body) {
	return {
		method: 'POST',
		url,
		headers: { 'content-type': 'application/json', 'x-forge-client': 'tester', 'x-client-region': 'US' },
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

let route = ['/api/forge', forgeHandler];
async function submitSketch() {
	const res = makeRes();
	await route[1](
		makeReq(route[0], { image_urls: [DRAWING], prompt: 'a cartoon rocket with two tail fins', path: 'sketch', tier: 'standard' }),
		res,
	);
	return res;
}

beforeEach(() => {
	trellisUp = true;
	createCreation.mockClear();
	markLaneUnhealthy.mockClear();
	recordingFetch();
});

describe.each([
	['/api/forge', forgeHandler],
	['/api/gpt-forge', gptForgeHandler],
])('POST %s path sketch with the scribble worker down', (url, handler) => {
	beforeEach(() => {
		route = [url, handler];
	});

	it('is served by an image lane instead of answering 503', async () => {
		const res = await submitSketch();

		expect(res.statusCode).toBe(200);
		expect(res.body.status).toBe('queued');
		expect(res.body.backend).toBe('trellis_selfhost');
		expect(res.body.failover_from).toBe('triposg');
		expect(typeof res.body.job_id).toBe('string');
	});

	it('hands the drawing to the image lane as its image', async () => {
		await submitSketch();

		const sketchCalls = requests.filter((r) => r.url === `${SKETCH_URL}/infer`);
		const trellisCalls = requests.filter((r) => r.url === `${TRELLIS_URL}/infer`);
		expect(sketchCalls).toHaveLength(1);
		expect(trellisCalls).toHaveLength(1);
		expect(trellisCalls[0].body.images).toEqual([DRAWING]);
	});

	it('says in words that the drawing is being treated as a picture', async () => {
		const res = await submitSketch();

		expect(res.body.failover_note).toMatch(/sketch/i);
		expect(res.body.failover_note).toMatch(/drawing/i);
		expect(res.body.failover_note).toMatch(/picture|image/i);
		expect(res.body.failover_note).not.toMatch(/triposg|worker|https?:|503/i);
	});

	it('records the job as an image job on the lane that took it, and cools the sketch worker', async () => {
		await submitSketch();

		expect(createCreation).toHaveBeenCalledTimes(1);
		expect(createCreation.mock.calls[0][0]).toMatchObject({
			backend: 'trellis_selfhost',
			path: 'image',
			previewImageUrl: DRAWING,
		});
		expect(markLaneUnhealthy).toHaveBeenCalledWith('triposg');
	});

	it('still ends on the designed retryable 503 when no image lane takes the drawing either', async () => {
		trellisUp = false;
		const res = await submitSketch();

		expect(res.statusCode).toBe(503);
		expect(res.body.error).toBe('generation_unavailable');
		expect(res.headers['retry-after']).toBe('20');
		expect(createCreation).not.toHaveBeenCalled();
	});
});
