/**
 * POST /api/forge?action=rig hands the caller's glb_url to the rig worker,
 * which fetches it from inside our network. A loopback, link-local (cloud
 * metadata) or private-range URL must be refused with 400 invalid_glb_url
 * before any job is queued, the same way every other server-side fetch of a
 * user URL is guarded (api/_lib/ssrf-guard.js).
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

// Deterministic DNS: a public answer for the CDN host, a private answer for a
// rebinding-style host. No test touches the real network.
vi.mock('node:dns', async (importActual) => {
	const actual = await importActual();
	const answers = {
		'cdn.example': [{ address: '93.184.216.34', family: 4 }],
		'rebind.example': [{ address: '10.0.0.5', family: 4 }],
	};
	const lookup = async (host) => {
		if (answers[host]) return answers[host];
		const err = new Error(`getaddrinfo ENOTFOUND ${host}`);
		err.code = 'ENOTFOUND';
		throw err;
	};
	return { ...actual, default: { ...actual, promises: { ...actual.promises, lookup } }, promises: { ...actual.promises, lookup } };
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

vi.mock('../api/_lib/rate-limit.js', async (importActual) => {
	const actual = await importActual();
	return {
		...actual,
		limits: {
			...actual.limits,
			mcp3dGenerate: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })),
			mcp3dGenerateGlobal: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })),
		},
		clientIp: () => '203.0.113.9',
	};
});

vi.mock('../api/_lib/forge-scale.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, dailyPaidAllowed: vi.fn(async () => ({ ok: true })) };
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

function makeReq(glbUrl) {
	const buf = Buffer.from(JSON.stringify({ glb_url: glbUrl }));
	const req = Readable.from([buf]);
	req.method = 'POST';
	req.url = '/api/forge?action=rig';
	req.headers = { 'content-type': 'application/json', 'content-length': String(buf.length), 'x-forge-client': 'tester' };
	return req;
}

beforeEach(() => submit.mockClear());

describe('forge rig glb_url guard', () => {
	it.each([
		['loopback', 'http://127.0.0.1/model.glb'],
		['localhost', 'http://localhost:8080/model.glb'],
		['cloud metadata', 'http://169.254.169.254/computeMetadata/v1/'],
		['private range', 'https://10.1.2.3/model.glb'],
		['IPv6 loopback', 'http://[::1]/model.glb'],
		['host resolving to a private address', 'https://rebind.example/model.glb'],
		['unresolvable host', 'https://nowhere.invalid/model.glb'],
	])('refuses a %s URL with 400 invalid_glb_url and queues nothing', async (_label, url) => {
		const res = makeRes();
		await handler(makeReq(url), res);
		expect(res.statusCode).toBe(400);
		expect(JSON.parse(res.body).error).toBe('invalid_glb_url');
		expect(submit).not.toHaveBeenCalled();
	});

	it('still queues a rig job for a public GLB URL', async () => {
		const res = makeRes();
		await handler(makeReq('https://cdn.example/model.glb'), res);
		expect(res.statusCode).toBe(200);
		expect(submit).toHaveBeenCalledTimes(1);
	});
});
