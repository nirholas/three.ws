/**
 * /api/cosmos world lane: the model ladder, the four generation modes, and the
 * resumable job contract (api/cosmos.js, api/_lib/cosmos-ladder.js,
 * api/_providers/cosmos-worker.js).
 *
 * The bug this file was written against: every hosted cosmos-predict function
 * this account could reach was retired (404 "Not found for account", 410 end of
 * life), so every POST /api/cosmos answered 503 and /cosmos had no worlds at all.
 * The fix puts the self-hosted Cosmos 3 Nano worker at the top of the ladder,
 * with the hosted predict1 routes behind it while NVIDIA still serves them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';

process.env.PUBLIC_APP_ORIGIN = 'https://three.ws';
process.env.APP_ORIGIN = 'https://three.ws';

const store = vi.hoisted(() => ({ puts: [], objects: new Map() }));
vi.mock('../api/_lib/r2.js', () => ({
	putObject: async ({ key, body, contentType }) => {
		store.puts.push({ key, size: body.length, contentType });
		store.objects.set(key, body);
	},
	headObject: async (key) => (store.objects.has(key) ? { ContentLength: store.objects.get(key).length } : null),
	cdnUrl: (key) => `https://three.ws/cdn/${key}`,
	isStorageInfrastructureError: () => false,
}));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: {
		cosmosWorldGenerate: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })),
		cosmosWorldGenerateGlobal: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })),
		mcp3dStatus: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })),
	},
	clientIp: () => '203.0.113.7',
}));

const { default: handler } = await import('../api/cosmos.js');

const WORKER = 'https://model-cosmos.test';
const TASK = 'a'.repeat(32);
const PNG = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]).toString('base64')}`;
const WEBM = `data:video/webm;base64,${Buffer.from('webm-bytes-for-the-test').toString('base64')}`;

let calls;
let routes;

function jsonResponse(status, body, headers = {}) {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

// Hosted NVCF answers exactly what production answered on 2026-11-16: the
// gateway path exists but the function behind it is gone for this account.
const HOSTED_RETIRED = () => jsonResponse(404, { detail: "Function 'f00d': Not found for account 'acct-redacted'" });

beforeEach(() => {
	calls = [];
	store.puts.length = 0;
	store.objects.clear();
	process.env.NVIDIA_API_KEY = 'nvapi-test';
	process.env.COSMOS_WORKER_URL = WORKER;
	process.env.COSMOS_WORKER_KEY = 'worker-secret';
	delete process.env.NVIDIA_COSMOS_INVOKE_URL;
	routes = {
		hosted: HOSTED_RETIRED,
		infer: () => jsonResponse(202, { task_id: TASK, status: 'queued', queue_position: 0, model: 'cosmos3-nano' }),
		task: () => jsonResponse(200, { status: 'queued' }),
		video: () => new Response(Buffer.from('mp4-bytes'), { status: 200, headers: { 'content-type': 'video/mp4' } }),
	};
	globalThis.fetch = vi.fn(async (input, init = {}) => {
		const url = String(input);
		const body = init.body ? JSON.parse(init.body) : null;
		calls.push({ url, method: init.method || 'GET', body, headers: init.headers || {} });
		if (url.startsWith('https://ai.api.nvidia.com/')) return routes.hosted(url);
		if (url === `${WORKER}/infer`) return routes.infer(body);
		if (url === `${WORKER}/tasks/${TASK}`) return routes.task();
		if (url === `${WORKER}/tasks/${TASK}/video`) return routes.video();
		throw new Error(`unexpected fetch ${url}`);
	});
});

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
		get json() {
			return this.body ? JSON.parse(this.body) : null;
		},
	};
}
function makeReq({ method = 'POST', url = '/api/cosmos', body = null } = {}) {
	const payload = body == null ? '' : JSON.stringify(body);
	const req = Readable.from(payload ? [Buffer.from(payload)] : []);
	req.method = method;
	req.url = url;
	req.query = {};
	req.headers = { 'content-type': 'application/json', host: 'three.ws', 'x-forwarded-proto': 'https' };
	return req;
}
const post = async (body) => {
	const res = makeRes();
	await handler(makeReq({ body }), res);
	return res;
};
const get = async (url) => {
	const res = makeRes();
	await handler(makeReq({ method: 'GET', url }), res);
	return res;
};

describe('the ladder puts the current Cosmos model first', () => {
	it('starts a text world on the self-hosted Cosmos 3 Nano worker even though every hosted route is retired', async () => {
		const res = await post({ prompt: 'a misty pine forest at dawn, slow dolly forward' });
		expect(res.statusCode).toBe(202);
		expect(res.json.job_id).toBe(`cw_${TASK}`);
		expect(res.json.model).toBe('cosmos3-nano');
		const infer = calls.find((c) => c.url === `${WORKER}/infer`);
		expect(infer.method).toBe('POST');
		expect(infer.headers.authorization).toBe('Bearer worker-secret');
		expect(infer.body).toMatchObject({ mode: 'text', prompt: 'a misty pine forest at dawn, slow dolly forward' });
		expect(calls.some((c) => c.url.startsWith('https://ai.api.nvidia.com/'))).toBe(false);
	});

	it('falls back to the hosted predict1 rung for a text world when the worker is not deployed', async () => {
		delete process.env.COSMOS_WORKER_URL;
		routes.hosted = () => new Response('', { status: 202, headers: { 'nvcf-reqid': '0f6c7a52-2b1e-4c55-9f1e-9d2b3c4d5e6f' } });
		const res = await post({ prompt: 'a neon city street in the rain' });
		expect(res.statusCode).toBe(202);
		expect(res.json.job_id).toBe('nv_0f6c7a52-2b1e-4c55-9f1e-9d2b3c4d5e6f');
		expect(res.json.model).toBe('cosmos-predict1-7b');
	});

	it('still lands on the designed offline state when no rung can serve', async () => {
		delete process.env.COSMOS_WORKER_URL;
		const res = await post({ prompt: 'a neon city street in the rain' });
		expect(res.statusCode).toBe(503);
		expect(res.json.error).toBe('lane_unavailable');
		expect(res.body).not.toContain('acct-redacted');
	});

	it('steps past a worker that is down to the hosted rung for text worlds', async () => {
		routes.infer = () => jsonResponse(503, { detail: 'model unavailable: weights missing' });
		routes.hosted = () => new Response('', { status: 202, headers: { 'nvcf-reqid': '0f6c7a52-2b1e-4c55-9f1e-9d2b3c4d5e6f' } });
		const res = await post({ prompt: 'a neon city street in the rain' });
		expect(res.statusCode).toBe(202);
		expect(res.json.model).toBe('cosmos-predict1-7b');
	});

	it('reports the lane busy instead of failing over when the worker queue is full', async () => {
		routes.infer = () => jsonResponse(429, { detail: '4 worlds are already queued; try again shortly' });
		const res = await post({ prompt: 'a neon city street in the rain' });
		expect(res.statusCode).toBe(429);
		expect(res.json.error).toBe('lane_busy');
		expect(calls.some((c) => c.url.startsWith('https://ai.api.nvidia.com/'))).toBe(false);
	});

	it('describes every rung with its own limits and modes on GET without a job', async () => {
		const res = await get('/api/cosmos');
		expect(res.statusCode).toBe(200);
		const [first, ...rest] = res.json.rungs;
		expect(first).toMatchObject({ id: 'cosmos3-nano', configured: true });
		// Describing the ladder must never wake a scale-to-zero GPU.
		expect(calls).toHaveLength(0);
		expect(first.modes).toEqual(['text', 'image', 'depth', 'edge']);
		expect(first.limits.prompt_max).toBe(600);
		expect(rest.map((r) => r.id)).toEqual(['cosmos-predict1-7b', 'cosmos-predict1-5b']);
		for (const r of rest) {
			expect(r.modes).toEqual(['text']);
			expect(r.limits.prompt_max).toBe(300);
		}
		expect(res.json.modes).toEqual(['text', 'image', 'depth', 'edge']);
	});
});

describe('worlds conditioned on the avatar and its scene', () => {
	it('sends the scene still as an image-to-world request', async () => {
		const res = await post({ mode: 'image', prompt: 'the camera slowly orbits the avatar', image: PNG, resolution: '480' });
		expect(res.statusCode).toBe(202);
		const infer = calls.find((c) => c.url === `${WORKER}/infer`);
		expect(infer.body).toMatchObject({ mode: 'image', image: PNG, resolution: '480' });
	});

	it('sends the three.js render as a depth or edge control video', async () => {
		for (const mode of ['depth', 'edge']) {
			calls.length = 0;
			const res = await post({ mode, prompt: 'a sunlit marble temple', control_video: WEBM });
			expect(res.statusCode).toBe(202);
			const infer = calls.find((c) => c.url === `${WORKER}/infer`);
			expect(infer.body).toMatchObject({ mode, control_video: WEBM });
		}
	});

	it('refuses a scene mode that has no scene attached', async () => {
		const missingImage = await post({ mode: 'image', prompt: 'orbit the avatar' });
		expect(missingImage.statusCode).toBe(400);
		expect(missingImage.json.error).toBe('invalid_input');
		const missingControl = await post({ mode: 'edge', prompt: 'a temple' });
		expect(missingControl.statusCode).toBe(400);
		expect(calls.some((c) => c.url === `${WORKER}/infer`)).toBe(false);
	});

	it('never sends a scene mode to a hosted rung that cannot condition on it', async () => {
		routes.infer = () => {
			throw new TypeError('fetch failed');
		};
		const res = await post({ mode: 'depth', prompt: 'a sunlit marble temple', control_video: WEBM });
		expect(res.statusCode).toBe(503);
		expect(res.json.error).toBe('lane_unavailable');
		expect(calls.some((c) => c.url.startsWith('https://ai.api.nvidia.com/'))).toBe(false);
	});

	it('passes the worker validation message through as an actionable 400', async () => {
		routes.infer = () => jsonResponse(400, { detail: 'control_video could not be decoded' });
		const res = await post({ mode: 'edge', prompt: 'a temple', control_video: WEBM });
		expect(res.statusCode).toBe(400);
		expect(res.json.message).toContain('control_video could not be decoded');
	});
});

describe('jobs resume from their id alone', () => {
	it('reports real progress while the worker samples', async () => {
		routes.task = () =>
			jsonResponse(200, {
				status: 'generating',
				mode: 'text',
				step: 14,
				total_steps: 35,
				progress: 0.4,
				eta_seconds: 51,
				upsampler: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
			});
		const res = await get(`/api/cosmos?job=cw_${TASK}`);
		expect(res.statusCode).toBe(200);
		expect(res.json).toMatchObject({
			job_id: `cw_${TASK}`,
			status: 'generating',
			step: 14,
			total_steps: 35,
			progress: 0.4,
			eta_seconds: 51,
			model: 'cosmos3-nano',
		});
		expect(res.json.video_url).toBeNull();
	});

	it('stores the finished clip in R2 under the job id and serves it from there on later polls', async () => {
		routes.task = () => jsonResponse(200, { status: 'done', progress: 1, timings: { sample_s: 101.2, total_s: 130.4 } });
		const first = await get(`/api/cosmos?job=cw_${TASK}`);
		expect(first.json.status).toBe('done');
		expect(first.json.video_url).toBe(`https://three.ws/cdn/forge/cosmos/cw_${TASK}.mp4`);
		expect(first.json.timings).toMatchObject({ sample_s: 101.2, total_s: 130.4 });
		expect(store.puts).toEqual([{ key: `forge/cosmos/cw_${TASK}.mp4`, size: 9, contentType: 'video/mp4' }]);

		calls.length = 0;
		const again = await get(`/api/cosmos?job=cw_${TASK}`);
		expect(again.json.video_url).toBe(first.json.video_url);
		expect(store.puts).toHaveLength(1);
		expect(calls.some((c) => c.url.endsWith('/video'))).toBe(false);
	});

	it('turns a worker failure code into a reason the user can act on', async () => {
		routes.task = () =>
			jsonResponse(200, {
				status: 'failed',
				error_code: 'bad_control_video',
				error: 'control_video produced no edges; the render looks blank',
			});
		const res = await get(`/api/cosmos?job=cw_${TASK}`);
		expect(res.json.status).toBe('failed');
		expect(res.json.error_code).toBe('bad_control_video');
		expect(res.json.error).toContain('no edges');
	});

	it('keeps polling through a worker that is momentarily unreachable', async () => {
		routes.task = () => {
			throw new TypeError('fetch failed');
		};
		const res = await get(`/api/cosmos?job=cw_${TASK}`);
		expect(res.json.status).toBe('queued');
		expect(res.json.error).toBeNull();
	});

	it('ends a job the worker no longer knows about', async () => {
		routes.task = () => jsonResponse(404, { detail: 'task not found' });
		const res = await get(`/api/cosmos?job=cw_${TASK}`);
		expect(res.json.status).toBe('failed');
		expect(res.json.error_code).toBe('expired');
	});

	it('rejects a malformed worker job id before any network call', async () => {
		const res = await get('/api/cosmos?job=cw_not-hex-at-all-zzzzzzzzzzzzzzzz');
		expect(res.statusCode).toBe(400);
		expect(calls).toHaveLength(0);
	});
});
