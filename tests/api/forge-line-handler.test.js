// Twenty people press Generate within a minute while the only image rung serves
// one image per 45 seconds (the 2026-11-26 production state).
//
// Before the waiting line: each request ran the whole reference ladder, nineteen
// were refused, and each was told "queued behind a few others: retry in ~45s"
// although no queue existed. Every retry raced the others, restarted the
// provider's window, spent another unit of the person's allowance, and the page
// said "Generation limit reached". This drives POST /api/forge the way those
// twenty people did and pins the honest behavior: one attempt at the rung, one
// place each in arrival order, real waits, a full answer past the depth, check-ins
// that say where you are, background jobs yielding, and no second charge on the
// turn a person already paid for.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

const state = vi.hoisted(() => ({ refImpl: null, refCalls: 0, paidLimiterCalls: 0, freeLimiterCalls: 0 }));

vi.mock('../../api/_lib/auth.js', async (orig) => ({
	...(await orig()),
	getRequestUser: async (req) => {
		const id = req?.headers?.['x-test-user'];
		return id ? { id } : null;
	},
}));

vi.mock('../../api/_lib/forge-lane-health.js', () => ({
	laneHealthSnapshot: vi.fn(async () => ({ byId: {}, statusMap: {} })),
	markLaneUnhealthy: vi.fn(async () => {}),
}));

// The free NIM lane is cooling, so the catch block's NIM rescue stays out of the
// way and the throttle reaches the line, as it did in production.
vi.mock('../../api/_lib/provider-health.js', async (importActual) => ({
	...(await importActual()),
	providersInCooldown: vi.fn(async (keys) => new Map((keys || []).map((k) => [k, { reason: 'test' }]))),
	markProviderCooldown: vi.fn(async () => {}),
}));

vi.mock('../../api/_lib/forge-reference-image.js', () => ({
	generateReferenceImage: async (...args) => {
		state.refCalls++;
		return state.refImpl(...args);
	},
}));

vi.mock('../../api/_providers/replicate.js', () => ({
	createRegenProvider: () => ({ submit: vi.fn(async () => ({ extJobId: 'rep-job-1' })) }),
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

vi.mock('../../api/_lib/rate-limit.js', async (importActual) => {
	const actual = await importActual();
	const ok = async () => ({ success: true, reset: Date.now() + 1000 });
	return {
		...actual,
		limits: {
			...actual.limits,
			mcp3dGenerate: vi.fn(async () => {
				state.paidLimiterCalls++;
				return ok();
			}),
			mcp3dGenerateFree: vi.fn(ok),
			mcp3dGenerateFreeTiered: vi.fn(async () => {
				state.freeLimiterCalls++;
				return ok();
			}),
			mcp3dGenerateGlobal: vi.fn(ok),
			mcp3dStatus: vi.fn(ok),
		},
		clientIp: () => '203.0.113.40',
	};
});

const refusal = () =>
	Object.assign(new Error('pollinations returned 402: FREE_LIMIT Free limit reached: 1 image every 45 seconds per IP'), {
		code: 'rate_limited',
		providerStatus: 402,
		retryAfter: 45,
		queued: true,
	});

beforeAll(() => {
	Object.assign(process.env, {
		APP_ORIGIN: 'https://three.ws',
		REPLICATE_API_TOKEN: 'test-token',
		JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
		CRON_SECRET: 'test-cron-secret',
	});
	delete process.env.NVIDIA_API_KEY;
	delete process.env.FORGE_REFERENCE_IMAGE;
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterAll(() => vi.restoreAllMocks());

const { default: handler } = await import('../../api/forge.js');

function makeReq({ method = 'POST', url = '/api/forge', user, body, headers = {} }) {
	return {
		method,
		url,
		headers: { 'content-type': 'application/json', 'x-forge-client': `browser-${user || 'none'}`, ...(user ? { 'x-test-user': user } : {}), ...headers },
		on(event, cb) {
			if (event === 'data' && body) cb(Buffer.from(JSON.stringify(body)));
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

const prompt = (i) => ({ prompt: `a carved wooden owl number ${i}`, tier: 'standard', path: 'image', backend: 'trellis' });

async function submit(user, i, extra = {}) {
	const res = makeRes();
	await handler(makeReq({ user, body: prompt(i), ...extra }), res);
	return res;
}

async function checkIn(user) {
	const res = makeRes();
	await handler(makeReq({ method: 'GET', url: '/api/forge?line=1', user }), res);
	return res;
}

// Every waiting page checks in at least every 15 s, which is what keeps a place.
async function everyoneChecksIn(users) {
	for (const u of users) await checkIn(u);
}

const waiting = (from, to) => Array.from({ length: to - from }, (_, i) => `u${from + i}`);

describe('POST /api/forge with twenty people and a saturated image rung', () => {
	// Taken once the first refusal has landed, so it is never earlier than the
	// moment the provider's stated wait started.
	let T0 = 0;
	const at = (ms) => vi.spyOn(Date, 'now').mockReturnValue(T0 + ms);

	it('answers the throttled first person with a real place, not a limit', async () => {
		state.refImpl = async () => {
			throw refusal();
		};
		const res = await submit('u0', 0);
		T0 = Date.now();
		expect(res.statusCode).toBe(429);
		expect(res.body).toMatchObject({ error: 'forge_queued', queued: true, position: 1, eta_seconds: 45 });
		expect(res.body.message).not.toMatch(/limit/i);
		expect(state.refCalls).toBe(1);
	});

	it('queues the next nineteen in order without touching the rung or their allowance', async () => {
		const before = state.paidLimiterCalls + state.freeLimiterCalls;
		const out = [];
		for (let i = 1; i < 20; i++) out.push(await submit(`u${i}`, i));
		expect(out.map((r) => r.statusCode)).toEqual(Array(19).fill(429));
		expect(out.map((r) => r.body.position)).toEqual(Array.from({ length: 19 }, (_, i) => i + 2));
		expect(out.every((r) => r.body.error === 'forge_queued' && !/limit/i.test(r.body.message))).toBe(true);
		expect(Number(out.at(-1).headers['retry-after'])).toBeGreaterThanOrEqual(1);
		expect(out.at(-1).body.eta_seconds).toBe(45 + 19 * 45);
		expect(state.refCalls).toBe(1);
		expect(state.paidLimiterCalls + state.freeLimiterCalls).toBe(before);
	});

	it('says full past the defined depth, with when to come back', async () => {
		const res = await submit('u20', 20);
		expect(res.statusCode).toBe(503);
		expect(res.body.error).toBe('forge_full');
		expect(Number(res.headers['retry-after'])).toBeGreaterThan(45);
	});

	it('keeps one place per person however often they press Generate', async () => {
		const a = await submit('u5', 105);
		const b = await submit('u5', 205);
		expect([a.body.position, b.body.position]).toEqual([6, 6]);
	});

	it('tells a person checking in where they are', async () => {
		const res = await checkIn('u3');
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({ in_line: true, your_turn: false, position: 4 });
		expect(res.body.check_again_seconds).toBeGreaterThanOrEqual(1);
	});

	it('makes a background seed job yield while people wait', async () => {
		const calls = state.refCalls;
		const res = await submit(null, 99, { headers: { 'x-forge-seed': 'test-cron-secret' } });
		expect(res.statusCode).toBe(503);
		expect(res.body.error).toBe('forge_yielding');
		expect(state.refCalls).toBe(calls);
	});

	it('gives the head its turn once the stated wait passes, without charging it again', async () => {
		at(30_000);
		await everyoneChecksIn(waiting(0, 20));
		at(46_000);
		await everyoneChecksIn(waiting(1, 20));
		const status = await checkIn('u0');
		expect(status.body).toMatchObject({ your_turn: true, check_again_seconds: 0 });

		const before = state.paidLimiterCalls + state.freeLimiterCalls;
		const res = await submit('u0', 0);
		expect(state.refCalls).toBe(2);
		// Refused again: still first, and the turn it already paid for was not charged.
		expect(res.body).toMatchObject({ error: 'forge_queued', position: 1 });
		expect(state.paidLimiterCalls + state.freeLimiterCalls).toBe(before);
	});

	it('moves everyone up when the head is served', async () => {
		at(80_000);
		await everyoneChecksIn(waiting(0, 20));
		at(92_000);
		await everyoneChecksIn(waiting(1, 20));
		state.refImpl = async () => ({ imageUrl: 'https://cdn.test/owl.png', model: 'pollinations/flux' });
		await submit('u0', 0);
		expect(state.refCalls).toBe(3);
		const next = await checkIn('u1');
		expect(next.body).toMatchObject({ in_line: true, position: 1, your_turn: false });
		// The next turn is paced by the provider's stated wait, not handed out at once.
		expect(next.body.eta_seconds).toBeGreaterThanOrEqual(44);
		expect((await checkIn('u0')).body.in_line).toBe(false);
	});

	it('lets a person leave the line', async () => {
		const res = makeRes();
		await handler(makeReq({ method: 'DELETE', url: '/api/forge?line=1', user: 'u19' }), res);
		expect(res.statusCode).toBe(200);
		expect(res.body.in_line).toBe(false);
		expect((await checkIn('u19')).body.in_line).toBe(false);
	});
});
