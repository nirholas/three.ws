/**
 * POST /api/forge?action=rig drives platform-paid GCP/Replicate rigging, so it
 * must honour the same global hourly and per-client daily breakers as the paid
 * reconstruction lanes. The per-IP cap alone is bypassed by rotating IPs.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { Readable } from 'node:stream';

beforeAll(() => {
	Object.assign(process.env, {
		APP_ORIGIN: 'https://three.ws',
		REPLICATE_API_TOKEN: 'test-token',
		REPLICATE_RERIG_MODEL: 'example/rigger',
	});
	delete process.env.GCP_RECONSTRUCTION_KEY;
});

const submit = vi.fn(async () => ({ extJobId: 'abcdef0123456789' }));
vi.mock('../api/_providers/replicate.js', () => ({
	createRegenProvider: () => ({ supportsMode: (m) => m === 'rerig', submit }),
}));

vi.mock('../api/_lib/forge-store.js', () => ({
	hashClient: (v) => `client:${v || 'anon'}`,
	hashIp: (v) => `ip:${v}`,
	createCreation: vi.fn(async () => 'creation-1'),
	materializeCreation: vi.fn(),
	markFailed: vi.fn(),
	findByJob: vi.fn(async () => null),
}));

const globalLimit = vi.fn(async () => ({ success: true, reset: Date.now() + 1000 }));
vi.mock('../api/_lib/rate-limit.js', async (importActual) => {
	const actual = await importActual();
	return {
		...actual,
		limits: {
			...actual.limits,
			mcp3dGenerate: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })),
			mcp3dGenerateGlobal: (...a) => globalLimit(...a),
		},
		clientIp: () => '203.0.113.9',
	};
});

const daily = vi.hoisted(() => ({ ok: true }));
vi.mock('../api/_lib/forge-scale.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, dailyPaidAllowed: vi.fn(async () => ({ ok: daily.ok })) };
});

const { default: handler } = await import('../api/forge.js');

function makeRes() {
	return {
		statusCode: 200,
		headers: {},
		body: null,
		setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
		getHeader(name) { return this.headers[String(name).toLowerCase()]; },
		end(body) { this.body = body ?? null; },
	};
}

function makeReq() {
	const buf = Buffer.from(JSON.stringify({ glb_url: 'https://cdn.example/model.glb' }));
	const req = Readable.from([buf]);
	req.method = 'POST';
	req.url = '/api/forge?action=rig';
	req.headers = { 'content-type': 'application/json', 'content-length': String(buf.length), 'x-forge-client': 'tester' };
	return req;
}

beforeEach(() => {
	submit.mockClear();
	globalLimit.mockClear();
	globalLimit.mockImplementation(async () => ({ success: true, reset: Date.now() + 1000 }));
	daily.ok = true;
});

describe('forge rig breakers', () => {
	it('submits a rig job when both breakers are open', async () => {
		const res = makeRes();
		await handler(makeReq(), res);
		expect(res.statusCode).toBe(200);
		expect(submit).toHaveBeenCalledTimes(1);
	});

	it('refuses with 429 and submits nothing when the global paid ceiling is hit', async () => {
		globalLimit.mockImplementation(async () => ({ success: false, reset: Date.now() + 1000 }));
		const res = makeRes();
		await handler(makeReq(), res);
		expect(res.statusCode).toBe(429);
		expect(submit).not.toHaveBeenCalled();
	});

	it('refuses with 429 and submits nothing when the per-client daily ceiling is hit', async () => {
		daily.ok = false;
		const res = makeRes();
		await handler(makeReq(), res);
		expect(res.statusCode).toBe(429);
		expect(JSON.parse(res.body).error).toBe('daily_limit_reached');
		expect(submit).not.toHaveBeenCalled();
	});
});
