/**
 * Throttle and circuit-breaker behaviour of the hosted NVIDIA TRELLIS lane,
 * driven through the real /api/forge handler with only the network-boundary
 * providers stubbed.
 *
 *   • a 429 with a stated Retry-After keeps the lane cooled for that long (not a
 *     fixed two minutes), and the cooldown lives in the shared cache so every
 *     instance sees it;
 *   • a dead key or an exhausted account (401/402/403) cools the lane for the
 *     long auth window instead of being re-probed by every request;
 *   • while the lane is cooled a request never reaches NVIDIA at all;
 *   • a poll that NVIDIA throttles is backed off for the stated time, shared
 *     across instances, so the waiting clients stop hammering the gateway;
 *   • a poll that reports exhausted credits cools the lane for submits too.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('../../api/_lib/auth.js', async (orig) => ({
	...(await orig()),
	getRequestUser: async () => ({ id: 'forge-test-user' }),
}));

beforeAll(() => {
	Object.assign(process.env, {
		APP_ORIGIN: 'https://three.ws',
		REPLICATE_API_TOKEN: 'test-token',
		NVIDIA_API_KEY: 'test-nvidia-key',
		JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
	});
});

// Shared cache stand-in that records the TTL each key was written with.
const cacheStore = new Map();
const cacheTtl = new Map();
const lockDenials = new Set();
const cacheGet = vi.fn(async (key) => (cacheStore.has(key) ? cacheStore.get(key) : null));
const cacheSet = vi.fn(async (key, value, ttl) => {
	cacheStore.set(key, value);
	cacheTtl.set(key, ttl);
});
vi.mock('../../api/_lib/cache.js', async (importActual) => {
	const actual = await importActual();
	return {
		...actual,
		cacheGet,
		cacheSet,
		cacheDel: vi.fn(async (key) => cacheStore.delete(key)),
		acquireLock: vi.fn(async (key) => !lockDenials.has(key)),
		releaseLock: vi.fn(async () => {}),
	};
});

const nvTextTo3d = vi.fn();
const nvStatus = vi.fn();
vi.mock('../../api/_providers/nvidia.js', () => ({
	createNvidiaProvider: () => ({ textTo3d: nvTextTo3d, status: nvStatus }),
}));

vi.mock('../../api/_providers/replicate.js', () => ({
	createRegenProvider: () => ({
		submit: vi.fn(async () => ({ extJobId: 'rep-job-1234567890' })),
	}),
}));
vi.mock('../../api/_mcp3d/text-to-image.js', () => ({
	textToImage: vi.fn(async () => ({ imageUrl: 'https://cdn.example/ref.png', model: 'flux' })),
}));

const markFailed = vi.fn(async () => {});
vi.mock('../../api/_lib/forge-store.js', () => ({
	hashClient: (v) => `client:${v || 'anon'}`,
	hashIp: (v) => `ip:${v}`,
	createCreation: vi.fn(async () => 'creation-1'),
	materializeCreation: vi.fn(async ({ glbUrl }) => ({ id: 'creation-1', glbUrl })),
	markFailed,
	findByJob: vi.fn(async () => null),
	runWithCreationContext: (_facts, fn) => fn(),
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
			mcp3dStatus: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })),
		},
		clientIp: () => '203.0.113.9',
	};
});

const { default: handler } = await import('../../api/forge.js');
const { encodeJobToken } = await import('../../api/_lib/forge-job-token.js');

const COOLDOWN_KEY = 'llm-cooldown:forge-nim-trellis';
const TASK_ID = 'nvcf-req-throttle-1';

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

async function submit() {
	const body = { prompt: 'a red ceramic coffee mug', tier: 'standard', path: 'image' };
	const req = {
		method: 'POST',
		url: '/api/forge',
		headers: { 'content-type': 'application/json', 'x-forge-client': 'tester', 'x-client-region': 'US' },
		on(event, cb) {
			if (event === 'data') cb(Buffer.from(JSON.stringify(body)));
			if (event === 'end') cb();
		},
	};
	const res = makeRes();
	await handler(req, res);
	return res;
}

async function poll() {
	const token = encodeJobToken({ provider: 'nvidia', kind: 'text-to-3d', taskId: TASK_ID });
	const req = {
		method: 'GET',
		url: `/api/forge?job=${encodeURIComponent(token)}`,
		headers: { 'x-forge-client': 'tester' },
		on() {},
	};
	const res = makeRes();
	await handler(req, res);
	return res;
}

const throttled = (retryAfter) =>
	Object.assign(new Error('NVIDIA returned 429'), {
		code: 'rate_limited',
		status: 429,
		providerStatus: 429,
		retryAfter,
	});

beforeEach(() => {
	vi.clearAllMocks();
	cacheStore.clear();
	cacheTtl.clear();
	lockDenials.clear();
});

describe('submit side: the breaker honors what NVIDIA says', () => {
	it('cools the lane for the stated Retry-After, not a fixed two minutes', async () => {
		nvTextTo3d.mockRejectedValueOnce(throttled(600));
		await submit();
		expect(cacheTtl.get(COOLDOWN_KEY)).toBe(600);
		expect(cacheStore.get(COOLDOWN_KEY).reason).toBe('health');
	});

	it('cools a dead key for the long auth window, tagged auth', async () => {
		nvTextTo3d.mockRejectedValueOnce(
			Object.assign(new Error('NVIDIA returned 401'), { code: 'invalid_key', status: 401, providerStatus: 401 }),
		);
		await submit();
		expect(cacheTtl.get(COOLDOWN_KEY)).toBe(300);
		expect(cacheStore.get(COOLDOWN_KEY).reason).toBe('auth');
	});

	it('cools an exhausted account (402) for the long auth window', async () => {
		nvTextTo3d.mockRejectedValueOnce(
			Object.assign(new Error('NVIDIA returned 402'), {
				code: 'insufficient_credits',
				status: 402,
				providerStatus: 402,
			}),
		);
		await submit();
		expect(cacheTtl.get(COOLDOWN_KEY)).toBe(300);
		expect(cacheStore.get(COOLDOWN_KEY).reason).toBe('auth');
	});

	it('does not cool the lane for a bad request the caller sent (422)', async () => {
		nvTextTo3d.mockRejectedValueOnce(
			Object.assign(new Error('NVIDIA returned 422'), { code: 'provider_error', status: 502, providerStatus: 422 }),
		);
		await submit();
		expect(cacheStore.has(COOLDOWN_KEY)).toBe(false);
	});

	it('a cooled lane costs nothing: the next request never reaches NVIDIA', async () => {
		nvTextTo3d.mockRejectedValueOnce(throttled(600));
		await submit();
		expect(nvTextTo3d).toHaveBeenCalledTimes(1);

		const res = await submit();
		expect(nvTextTo3d).toHaveBeenCalledTimes(1);
		expect(res.statusCode).toBeLessThan(500);
	});
});

describe('poll side: a throttled poll is backed off for its stated time', () => {
	it('stops polling NVIDIA until the stated wait is over, sharing the wait through the cache', async () => {
		nvStatus.mockResolvedValueOnce({ status: 'running', retryAfter: 45 });
		const first = await poll();
		expect(first.body.status).toBe('running');
		expect(nvStatus).toHaveBeenCalledTimes(1);
		expect(cacheTtl.get(`nvcf:poll-backoff:${TASK_ID}`)).toBe(45);

		const second = await poll();
		expect(second.body.status).toBe('running');
		expect(nvStatus).toHaveBeenCalledTimes(1);
	});

	it('cools the lane for new submits while NVIDIA is throttling the polls', async () => {
		nvStatus.mockResolvedValueOnce({ status: 'running', retryAfter: 90 });
		await poll();
		expect(cacheTtl.get(COOLDOWN_KEY)).toBe(90);
	});

	it('an ordinary still-running poll sets no backoff and keeps polling', async () => {
		nvStatus.mockResolvedValue({ status: 'running' });
		await poll();
		await poll();
		expect(nvStatus).toHaveBeenCalledTimes(2);
		expect(cacheStore.has(`nvcf:poll-backoff:${TASK_ID}`)).toBe(false);
		expect(cacheStore.has(COOLDOWN_KEY)).toBe(false);
	});

	it('a poll that reports exhausted credits cools the lane for the auth window', async () => {
		nvStatus.mockResolvedValueOnce({
			status: 'failed',
			error: 'NVCF credits exhausted',
			code: 'insufficient_credits',
			providerStatus: 402,
		});
		await poll();
		expect(cacheTtl.get(COOLDOWN_KEY)).toBe(300);
		expect(cacheStore.get(COOLDOWN_KEY).reason).toBe('auth');
	});
});
