/**
 * The generation allowance, driven through the real /api/forge and
 * /api/gpt-forge handlers with the production limiter code. Only the network
 * boundaries are replaced: the Upstash REST client and its sliding-window
 * library by an in-memory store that keeps the same semantics, and the
 * providers by stubs that answer the way the real ones do.
 *
 * Fairness: a request Forge failed before doing work for the person costs them
 * nothing. Each "Forge failed first" exit is driven here and the caller's
 * bucket is read before and after:
 *   - the image provider throttled the reference image (429, also `queued`),
 *   - the reconstruction lane throttled the submit (429),
 *   - paid capacity (the platform-wide breaker) is full,
 *   - the per-identity daily paid cap is reached (the denied attempt itself
 *     must not eat a later refund),
 *   - a forge-in-world refusal (player cooldown),
 *   - an accepted job whose lane later fails (handed back exactly once on the
 *     terminal poll, never for a photo the worker could not read).
 *
 * Accuracy: every one of those 429s names its limit, says how long to wait and
 * carries the standard headers.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

process.env.FORGE_PAID_GLOBAL_HOURLY = '5';
process.env.FORGE_PAID_DAILY_CAP = '2';

let currentUser = 'fair-0';
vi.mock('../../api/_lib/auth.js', async (orig) => ({
	...(await orig()),
	getRequestUser: async () => ({ id: currentUser }),
}));

// In-memory stand-in for the Upstash REST client: the handful of commands the
// limiter, the daily cap and the charge ledger issue. Anything else rejects, so
// every other caller takes its own fail-soft branch exactly as it would on a
// Redis error.
const kv = new Map();
const lists = new Map();
const redisCommands = {
	async get(k) {
		return kv.has(k) ? kv.get(k) : null;
	},
	async set(k, v, opts) {
		if (opts?.nx && kv.has(k)) return null;
		kv.set(k, v);
		return 'OK';
	},
	async incr(k) {
		const n = Number(kv.get(k) || 0) + 1;
		kv.set(k, n);
		return n;
	},
	async decr(k) {
		const n = Number(kv.get(k) || 0) - 1;
		kv.set(k, n);
		return n;
	},
	async expire() {
		return 1;
	},
	async del(...keys) {
		for (const k of keys.flat()) {
			kv.delete(k);
			lists.delete(k);
		}
		return 1;
	},
	async rpush(k, ...values) {
		const l = lists.get(k) || [];
		l.push(...values);
		lists.set(k, l);
		return l.length;
	},
	async lpop(k) {
		const l = lists.get(k);
		return l && l.length ? l.shift() : null;
	},
	pipeline() {
		throw new Error('redis pipeline is not part of this test');
	},
};
const redisStub = new Proxy(redisCommands, {
	get(target, prop) {
		if (prop in target) return target[prop];
		if (prop === 'then') return undefined;
		return async () => {
			throw new Error(`redis command ${String(prop)} is not part of this test`);
		};
	},
});
vi.mock('../../api/_lib/redis.js', async (orig) => ({
	...(await orig()),
	getRedis: () => redisStub,
}));

// Same contract as @upstash/ratelimit's sliding window: a denied request is not
// counted, and a negative rate hands tokens back.
const windows = new Map();
vi.mock('@upstash/ratelimit', () => {
	const parse = (w) => {
		const [n, unit] = String(w).split(/\s+/);
		return Number(n) * ({ s: 1e3, m: 6e4, h: 3.6e6, d: 8.64e7 }[unit] || 1e3);
	};
	class Ratelimit {
		static slidingWindow(limit, window) {
			return { limit, ms: parse(window) };
		}
		constructor({ limiter, prefix }) {
			this.cfg = limiter;
			this.prefix = prefix;
		}
		async limit(id, opts = {}) {
			const key = `${this.prefix}:${id}`;
			const now = Date.now();
			const hits = (windows.get(key) || []).filter((t) => t > now - this.cfg.ms);
			const rate = opts.rate ?? 1;
			let success = true;
			if (rate < 0) hits.splice(Math.max(0, hits.length + rate), -rate);
			else if (hits.length + rate > this.cfg.limit) success = false;
			else for (let i = 0; i < rate; i++) hits.push(now);
			windows.set(key, hits);
			return {
				success,
				limit: this.cfg.limit,
				remaining: Math.max(0, this.cfg.limit - hits.length),
				reset: now + this.cfg.ms,
			};
		}
		async resetUsedTokens(id) {
			windows.delete(`${this.prefix}:${id}`);
		}
	}
	return { Ratelimit };
});

let textToImageImpl = async () => ({ imageUrl: 'https://cdn.example/ref.png', model: 'flux' });
vi.mock('../../api/_mcp3d/text-to-image.js', async (orig) => ({
	...(await orig()),
	textToImage: vi.fn((...a) => textToImageImpl(...a)),
}));

let gcpSubmitImpl = async () => ({ extJobId: 'gcp-task-ok' });
let gcpStatusImpl = async () => ({ status: 'running' });
vi.mock('../../api/_providers/gcp.js', () => ({
	createRegenProvider: () => ({
		submit: vi.fn((...a) => gcpSubmitImpl(...a)),
		status: vi.fn((...a) => gcpStatusImpl(...a)),
		supportsMode: () => true,
	}),
}));

let replicateSubmitImpl = async () => ({ extJobId: 'rep-job-1234567890' });
vi.mock('../../api/_providers/replicate.js', () => ({
	createRegenProvider: () => ({
		submit: vi.fn((...a) => replicateSubmitImpl(...a)),
		status: vi.fn(async () => ({ status: 'running' })),
		supportsMode: () => true,
	}),
}));

let row = null;
vi.mock('../../api/_lib/forge-store.js', () => ({
	hashClient: (v) => `client:${v || 'anon'}`,
	hashIp: (v) => `ip:${v}`,
	ownerClientKey: (k) => (typeof k === 'string' && k ? k : null),
	createCreation: vi.fn(async () => 'creation-1'),
	materializeCreation: vi.fn(async ({ glbUrl }) => ({ id: 'creation-1', glbUrl })),
	markFailed: vi.fn(async () => {}),
	markSupersededBy: vi.fn(async () => true),
	findByJob: vi.fn(async () => row),
	runWithCreationContext: (_facts, fn) => fn(),
}));
vi.mock('../../api/_lib/forge-image-validate.js', () => ({
	validateForgeImage: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../../api/_lib/forge-lane-health.js', async (orig) => ({
	...(await orig()),
	laneHealthSnapshot: vi.fn(async () => ({ byId: {} })),
	markLaneUnhealthy: vi.fn(async () => {}),
}));
vi.mock('../../api/_lib/forge-failover.js', async (orig) => ({
	...(await orig()),
	resolveLiveJob: vi.fn(async () => null),
	bindJobSuccessor: vi.fn(async () => true),
}));
vi.mock('../../api/_lib/rate-limit.js', async (orig) => ({
	...(await orig()),
	clientIp: () => '203.0.113.9',
}));

beforeAll(() => {
	Object.assign(process.env, {
		APP_ORIGIN: 'https://three.ws',
		JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
		GCP_HUNYUAN3D_URL: 'https://hunyuan3d.example.run.app',
		GCP_RECONSTRUCTION_KEY: 'test-gcp-key',
		REPLICATE_API_TOKEN: 'test-token',
	});
});

const { limits } = await import('../../api/_lib/rate-limit.js');
const { resetMemoryLine } = await import('../../api/_lib/forge-line.js');
const { dailyPaidAllowed, dailyPaidRefund } = await import('../../api/_lib/forge-scale.js');
const HANDLERS = [
	['api/forge.js', (await import('../../api/forge.js')).default],
	['api/gpt-forge.js', (await import('../../api/gpt-forge.js')).default],
];

let seq = 0;
function freshUser() {
	currentUser = `fair-${++seq}-${Math.random().toString(36).slice(2, 8)}`;
	return `user:${currentUser}`;
}

function makeRes() {
	const res = new EventEmitter();
	Object.assign(res, {
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
			this.emit('finish');
		},
	});
	return res;
}

// Let the response's finish listeners (refunds, the job binding) settle.
const settle = () => new Promise((r) => setTimeout(r, 5));

async function submit(handler, body, { url = '/api/forge', headers = {} } = {}) {
	const req = {
		method: 'POST',
		url,
		headers: {
			'content-type': 'application/json',
			'x-forge-client': 'tester',
			'x-client-region': 'US',
			...headers,
		},
		on(event, cb) {
			if (event === 'data') cb(Buffer.from(JSON.stringify(body)));
			if (event === 'end') cb();
		},
	};
	const res = makeRes();
	await handler(req, res);
	await settle();
	return res;
}

async function poll(handler, jobId) {
	const req = {
		method: 'GET',
		url: `/api/forge?job=${encodeURIComponent(jobId)}`,
		headers: { 'x-forge-client': 'tester' },
		on(event, cb) {
			if (event === 'end') cb();
		},
	};
	const res = makeRes();
	await handler(req, res);
	await settle();
	return res;
}

// How many generations the caller has left, read without spending one.
async function freeLeft(key) {
	const r = await limits.mcp3dGenerateFreeTiered(key, 1);
	await limits.mcp3dGenerateFreeRefund(key, 1);
	return r.success ? r.remaining + 1 : 0;
}
async function paidLeft(key) {
	const r = await limits.mcp3dGenerate(key);
	await limits.mcp3dGenerateRefund(key);
	return r.success ? r.remaining + 1 : 0;
}
async function globalLeft() {
	const r = await limits.mcp3dGenerateGlobal();
	if (r.success) await limits.mcp3dGenerateGlobalRefund();
	return r.success ? r.remaining + 1 : 0;
}
async function dailyUsed(key) {
	const day = Math.floor(Date.now() / 86_400_000);
	return Number(kv.get(`fc:daily:${key}:${day}`) || 0);
}

const FREE_TEXT = { prompt: 'a brass lantern with a glass chimney', tier: 'standard', path: 'image', backend: 'hunyuan3d' };
const PAID_TEXT = { prompt: 'a brass lantern with a glass chimney', tier: 'standard', path: 'image', backend: 'trellis' };

const throttled = (extra = {}) =>
	Object.assign(new Error('provider returned 429'), { code: 'rate_limited', status: 429, providerStatus: 429, retryAfter: 20, ...extra });

function expectLimit429(res, name) {
	expect(res.statusCode).toBe(429);
	expect(res.body.limit).toBe(name);
	expect(Number.isInteger(res.body.retry_after)).toBe(true);
	expect(res.body.retry_after).toBeGreaterThan(0);
	expect(res.headers['retry-after']).toBe(String(res.body.retry_after));
}

beforeEach(() => {
	resetMemoryLine();
	row = null;
	textToImageImpl = async () => ({ imageUrl: 'https://cdn.example/ref.png', model: 'flux' });
	gcpSubmitImpl = async () => ({ extJobId: `gcp-task-${++seq}` });
	gcpStatusImpl = async () => ({ status: 'running' });
	replicateSubmitImpl = async () => ({ extJobId: `rep-job-${++seq}-abcdefghij` });
});

describe.each(HANDLERS)('%s: a request Forge failed first costs nothing', (_name, handler) => {
	it('the image provider throttling the reference image leaves the hourly allowance unchanged', async () => {
		const key = freshUser();
		const before = await freeLeft(key);
		textToImageImpl = async () => {
			throw throttled();
		};
		const res = await submit(handler, FREE_TEXT);
		expectLimit429(res, 'provider_busy');
		expect(res.body.error).toBe('rate_limited');
		expect(await freeLeft(key)).toBe(before);
	});

	it('a queued throttle (our own pacing gate) leaves the hourly allowance unchanged', async () => {
		const key = freshUser();
		const before = await freeLeft(key);
		textToImageImpl = async () => {
			throw throttled({ queued: true, retryAfter: 15 });
		};
		const res = await submit(handler, FREE_TEXT);
		expectLimit429(res, 'provider_busy');
		expect(res.body.queued).toBe(true);
		expect(await freeLeft(key)).toBe(before);
	});

	it('the reconstruction lane throttling the submit leaves the hourly allowance unchanged', async () => {
		const key = freshUser();
		const before = await freeLeft(key);
		gcpSubmitImpl = async () => {
			throw throttled();
		};
		const res = await submit(handler, FREE_TEXT);
		expect(res.statusCode).toBe(429);
		expect(await freeLeft(key)).toBe(before);
	});

	it('paid capacity being full leaves the hourly and the breaker unchanged, and names the limit', async () => {
		const key = freshUser();
		const free = await globalLeft();
		for (let i = 0; i < free; i++) await limits.mcp3dGenerateGlobal();
		const before = await paidLeft(key);
		const res = await submit(handler, PAID_TEXT);
		expectLimit429(res, 'paid_capacity');
		expect(res.headers['ratelimit-limit']).toBe('5');
		expect(res.headers['ratelimit-remaining']).toBe('0');
		expect(Number(res.headers['ratelimit-reset'])).toBeGreaterThan(0);
		expect(await paidLeft(key)).toBe(before);
		expect(await globalLeft()).toBe(0);
		for (let i = 0; i < free; i++) await limits.mcp3dGenerateGlobalRefund();
	});

	it('the daily paid cap refusal leaves the hourly, the breaker and the daily count unchanged', async () => {
		const key = freshUser();
		await dailyPaidAllowed(key, { limit: 2 });
		await dailyPaidAllowed(key, { limit: 2 });
		const paidBefore = await paidLeft(key);
		const globalBefore = await globalLeft();
		const res = await submit(handler, PAID_TEXT);
		expect(res.statusCode).toBe(429);
		expect(res.body.error).toBe('daily_limit_reached');
		expect(res.body.limit).toBe('generation_daily');
		expect(new Date(res.body.reset_at).getTime() % 86_400_000).toBe(0);
		expect(res.headers['retry-after']).toBe(String(res.body.retry_after));
		expect(res.headers['ratelimit-limit']).toBe('2');
		expect(res.headers['ratelimit-remaining']).toBe('0');
		expect(await paidLeft(key)).toBe(paidBefore);
		expect(await globalLeft()).toBe(globalBefore);
		// The refused attempt is not counted, so one refund reopens the allowance.
		expect(await dailyUsed(key)).toBe(2);
		await dailyPaidRefund(key);
		expect((await dailyPaidAllowed(key, { limit: 2 })).ok).toBe(true);
	});

	it('a job its lane fails later hands the hourly allowance back exactly once', async () => {
		const key = freshUser();
		const before = await freeLeft(key);
		const sub = await submit(handler, FREE_TEXT);
		expect(sub.statusCode).toBe(200);
		expect(sub.body.job_id).toBeTruthy();
		expect(await freeLeft(key)).toBe(before - 1);

		gcpStatusImpl = async () => ({ status: 'failed', error: 'worker crashed: CUDA out of memory' });
		const first = await poll(handler, sub.body.job_id);
		expect(first.body.status).toBe('failed');
		expect(await freeLeft(key)).toBe(before);

		const second = await poll(handler, sub.body.job_id);
		expect(second.body.status).toBe('failed');
		expect(await freeLeft(key)).toBe(before);
	});

	it('a photo the worker could not read stays charged: the input was the problem', async () => {
		const key = freshUser();
		const before = await freeLeft(key);
		const sub = await submit(handler, FREE_TEXT);
		expect(sub.statusCode).toBe(200);
		gcpStatusImpl = async () => ({ status: 'failed', error: 'input image unusable: no foreground subject found' });
		const res = await poll(handler, sub.body.job_id);
		expect(res.body.status).toBe('failed');
		expect(await freeLeft(key)).toBe(before - 1);
	});

	it('a finished job keeps its charge', async () => {
		const key = freshUser();
		const before = await freeLeft(key);
		const sub = await submit(handler, FREE_TEXT);
		expect(sub.statusCode).toBe(200);
		gcpStatusImpl = async () => ({ status: 'running' });
		await poll(handler, sub.body.job_id);
		expect(await freeLeft(key)).toBe(before - 1);
	});
});

describe('api/forge.js: forge-in-world refusals', () => {
	const handler = HANDLERS[0][1];

	it('a player cooldown refusal leaves the hourly allowance unchanged and names the limit', async () => {
		const key = freshUser();
		await limits.forgeWorldPlayer(key);
		const before = await freeLeft(key);
		const res = await submit(handler, { ...FREE_TEXT, world: 'plaza-1' });
		expectLimit429(res, 'world_player_cooldown');
		expect(res.body.scope).toBe('player');
		expect(res.headers['ratelimit-limit']).toBe('1');
		expect(await freeLeft(key)).toBe(before);
	});
});

describe('identity: nothing the caller sends picks the bucket', () => {
	const handler = HANDLERS[0][1];

	it('a made-up x-forge-client or forwarded header charges the same account bucket', async () => {
		const key = freshUser();
		const before = await freeLeft(key);
		await submit(handler, FREE_TEXT, { headers: { 'x-forge-client': 'made-up-1', 'x-forwarded-for': '6.6.6.6' } });
		await submit(handler, FREE_TEXT, { headers: { 'x-forge-client': 'made-up-2', 'x-forwarded-for': '7.7.7.7' } });
		expect(await freeLeft(key)).toBe(before - 2);
	});
});
