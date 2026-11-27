/**
 * When the protected TRELLIS lane refuses a photo submit, the user still gets a
 * job from a later lane.
 *
 * Forge hardening 10 (2026-11-27). After trellis_selfhost refuses, the handler
 * hands the request to Hunyuan3D when it is wired. A Hunyuan3D refusal used to
 * throw straight to a 502, because the submit fallback chain only continued for
 * the paid `trellis` lane, although TripoSG (or any other configured lane) could
 * have served the photo. These tests drive a real POST through both forge
 * handlers with the real gcp provider and the real lane-health module, record
 * every outbound request, and pin: each lane is asked at most once, a cooled or
 * unconfigured lane costs no request, and when every lane refuses the answer is
 * a specific, counted 503 rather than a generic failure.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';

vi.mock('../../api/_lib/auth.js', async (orig) => ({
	...(await orig()),
	getRequestUser: async () => ({ id: 'forge-test-user' }),
}));

vi.mock('../../api/_mcp3d/text-to-image.js', () => ({
	textToImage: vi.fn(async () => ({ imageUrl: 'https://cdn.example/ref.png', model: 'flux' })),
	synthesizeTurnaroundViews: vi.fn(async () => []),
}));

vi.mock('../../api/_lib/forge-store.js', () => ({
	hashClient: (v) => `client:${v || 'anon'}`,
	hashIp: (v) => `ip:${v}`,
	createCreation: vi.fn(async () => 'creation-1'),
	materializeCreation: vi.fn(async ({ glbUrl }) => ({ id: 'creation-1', glbUrl })),
	markFailed: vi.fn(async () => {}),
	findByJob: vi.fn(async () => null),
	runWithCreationContext: (_facts, fn) => fn(),
}));

vi.mock('../../api/_lib/forge-image-validate.js', () => ({
	validateForgeImage: vi.fn(async () => ({ ok: true })),
}));

const recordSubmitOutcome = vi.fn(async () => {});
vi.mock('../../api/_lib/forge-events.js', async (orig) => ({
	...(await orig()),
	recordSubmitOutcome: (...args) => recordSubmitOutcome(...args),
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

const TRELLIS_URL = 'https://trellis.example.run.app';
const HUNYUAN_URL = 'https://hunyuan.example.run.app';
const TRIPOSG_URL = 'https://triposg.example.run.app';
const PHOTO = 'https://cdn.example/photo.png';
const LANES = ['trellis_selfhost', 'hunyuan3d', 'triposg', 'trellis2', 'modly', 'modly_hunyuan', 'trellis', 'huggingface'];

const ENV = {
	APP_ORIGIN: 'https://three.ws',
	MODEL_TRELLIS_URL: TRELLIS_URL,
	GCP_HUNYUAN3D_URL: HUNYUAN_URL,
	GCP_TRIPOSG_URL: TRIPOSG_URL,
	GCP_RECONSTRUCTION_KEY: 'test-gcp-key',
	FORGE_SELFHOST_PRIMARY: '1',
	NVIDIA_API_KEY: 'nvapi-test',
	JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
};
const CLEARED = ['MODEL_TRELLIS2_URL', 'MODEL_MODLY_URL', 'MODEL_PIXAL3D_URL', 'HF_TOKEN', 'REPLICATE_API_TOKEN', 'FORGE_KEEPWARM_LANES'];
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
const { resetLaneHealthCache, markLaneUnhealthy, laneCooldownKey } = await import('../../api/_lib/forge-lane-health.js');
const { clearProviderCooldown } = await import('../../api/_lib/provider-health.js');

// Per-host answers to a submit. Health probes always answer ready, so routing
// and the failover chain see every lane as routable until a submit refuses.
let submitAnswer = {};
let requests = [];
function recordingFetch() {
	requests = [];
	globalThis.fetch = vi.fn(async (input, opts = {}) => {
		const url = String(input?.url || input);
		const method = opts.method || 'GET';
		requests.push({ url, method });
		if (url.endsWith('/health')) {
			return new Response(JSON.stringify({ ok: true, ready: true }), { status: 200 });
		}
		const host = [TRELLIS_URL, HUNYUAN_URL, TRIPOSG_URL].find((h) => url.startsWith(h));
		if (host && method === 'POST') {
			const status = submitAnswer[host] ?? 503;
			if (status === 202) {
				return new Response(JSON.stringify({ task_id: `task-${host.split('//')[1].split('.')[0]}`, status: 'queued' }), {
					status: 202,
					headers: { 'content-type': 'application/json' },
				});
			}
			return new Response('worker busy', { status });
		}
		return new Response('not found', { status: 404 });
	});
}

const submitsTo = (host) => requests.filter((r) => r.method === 'POST' && r.url.startsWith(host));
const anyRequestTo = (host) => requests.filter((r) => r.url.startsWith(host));

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
		getHeader(name) {
			return this.headers[String(name).toLowerCase()];
		},
		end(body) {
			this.body = body ? JSON.parse(body) : null;
		},
	};
}

const photoBody = { image_urls: [PHOTO], tier: 'draft', path: 'image', skip_validation: true };

beforeEach(async () => {
	resetLaneHealthCache();
	for (const id of LANES) await clearProviderCooldown(laneCooldownKey(id));
	recordSubmitOutcome.mockClear();
	submitAnswer = {};
	recordingFetch();
});

describe.each([
	['/api/forge', forgeHandler],
	['/api/gpt-forge', gptForgeHandler],
])('%s: the protected lane refuses a photo submit', (url, handler) => {
	it('Hunyuan3D refuses too: TripoSG serves, each lane asked once', async () => {
		submitAnswer = { [TRELLIS_URL]: 503, [HUNYUAN_URL]: 503, [TRIPOSG_URL]: 202 };
		const res = makeRes();
		await handler(makeReq(url, photoBody), res);

		expect(res.statusCode).toBe(200);
		expect(res.body.backend).toBe('triposg');
		expect(res.body.status).toBe('queued');
		expect(submitsTo(TRELLIS_URL)).toHaveLength(1);
		expect(submitsTo(HUNYUAN_URL)).toHaveLength(1);
		expect(submitsTo(TRIPOSG_URL)).toHaveLength(1);
	});

	it('a Hunyuan3D lane another request just cooled costs no request at all', async () => {
		await markLaneUnhealthy('hunyuan3d');
		submitAnswer = { [TRELLIS_URL]: 503, [TRIPOSG_URL]: 202 };
		const res = makeRes();
		await handler(makeReq(url, photoBody), res);

		expect(res.statusCode).toBe(200);
		expect(res.body.backend).toBe('triposg');
		expect(anyRequestTo(HUNYUAN_URL)).toEqual([]);
		expect(submitsTo(TRELLIS_URL)).toHaveLength(1);
	});

	it('every lane refuses: a specific, counted 503 naming the lanes tried, each asked once', async () => {
		submitAnswer = { [TRELLIS_URL]: 503, [HUNYUAN_URL]: 503, [TRIPOSG_URL]: 503 };
		const res = makeRes();
		await handler(makeReq(url, photoBody), res);

		expect(res.statusCode).toBe(503);
		expect(res.body.error).toBe('generation_unavailable');
		expect(res.body.reason).toBe('all_lanes_failed');
		expect(res.body.lanes_tried).toEqual(expect.arrayContaining(['trellis_selfhost', 'hunyuan3d', 'triposg']));
		expect(res.body.retryable).toBe(true);
		expect(res.body.retry_after).toBeGreaterThan(0);
		expect(res.headers['retry-after']).toBe(String(res.body.retry_after));
		expect(res.body.message).toMatch(/engine/i);
		expect(submitsTo(TRELLIS_URL)).toHaveLength(1);
		expect(submitsTo(HUNYUAN_URL)).toHaveLength(1);
		expect(submitsTo(TRIPOSG_URL)).toHaveLength(1);
		expect(recordSubmitOutcome).toHaveBeenCalledWith(
			expect.objectContaining({ outcome: 'failed', cause: 'all_lanes_failed', httpStatus: 503 }),
		);
	});
});

describe('a lane with no env is skipped with no network call', () => {
	beforeEach(() => {
		delete process.env.GCP_HUNYUAN3D_URL;
	});
	afterAll(() => {
		process.env.GCP_HUNYUAN3D_URL = HUNYUAN_URL;
	});

	it.each([
		['/api/forge', forgeHandler],
		['/api/gpt-forge', gptForgeHandler],
	])('%s: Hunyuan3D unset, the handover goes straight to TripoSG', async (url, handler) => {
		submitAnswer = { [TRELLIS_URL]: 503, [TRIPOSG_URL]: 202 };
		const res = makeRes();
		await handler(makeReq(url, photoBody), res);

		expect(res.statusCode).toBe(200);
		expect(res.body.backend).toBe('triposg');
		expect(anyRequestTo(HUNYUAN_URL)).toEqual([]);
		// Only the two configured workers were ever contacted.
		expect(requests.every((r) => r.url.startsWith(TRELLIS_URL) || r.url.startsWith(TRIPOSG_URL))).toBe(true);
	});
});
