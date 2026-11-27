// A user's own provider key on the Forge bring-your-own-key lanes.
//
// The key costs its owner money, so these tests follow a marker key through the
// real handler and the real provider adapters with only the network boundary
// stubbed, and assert the marker never reaches a log line, a response body, a
// thrown error, a URL, or a host that is not the provider's own. They also pin
// the rest of the contract: a malformed key is refused before any billed call,
// each failure class has its own code and message, and a BYOK failure never
// falls back silently to a platform-paid engine.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Readable } from 'node:stream';

vi.mock('../api/_lib/auth.js', async (orig) => ({
	...(await orig()),
	getRequestUser: async () => ({ id: 'byok-test-user' }),
}));

// Reference-image fetches are SSRF-checked with DNS; the fixtures use offline
// hosts, and that check has its own suite (tests/ssrf-hardening-guards.test.js).
vi.mock('../api/_lib/ssrf-guard.js', async (importOriginal) => ({
	...(await importOriginal()),
	assertSafePublicUrl: async (u) => new URL(u),
}));

vi.mock('../api/_lib/r2.js', async (importOriginal) => ({
	...(await importOriginal()),
	putObject: vi.fn(async () => ({})),
	cdnUrl: (key) => `https://three.ws/cdn/${key}`,
}));

const ORIGINAL_FETCH = globalThis.fetch;
const ENV_KEYS = ['TRIPO_API_KEY', 'NVIDIA_API_KEY', 'JWT_SECRET'];
const priorEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

// A distinct, searchable key per provider, each with the prefix its vendor uses.
const MARKER = 'ZZMARKER9f3a7c1e5b2d4086';
const KEYS = {
	tripo: `tsk_${MARKER}`,
	meshy: `msy_${MARKER}`,
	rodin: `rodin${MARKER}`,
	stability: `sk-${MARKER}`,
};
const HOSTS = {
	tripo: 'openapi.tripo3d.com',
	meshy: 'api.meshy.ai',
	rodin: 'api.hyper3d.com',
	stability: 'api.stability.ai',
};
const TIER = { id: 'draft', polycount: 30000, pbr: false, hd: false };

let calls;
let logSpies;

function stubFetch(answer) {
	calls = [];
	globalThis.fetch = vi.fn(async (url, init) => {
		calls.push({ url: String(url), init: init || {} });
		return answer(String(url), init || {});
	});
}

function jsonRes(status, body) {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function loggedText() {
	return logSpies.flatMap((s) => s.mock.calls.map((args) => args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' '))).join('\n');
}

function assertNoLeak(...surfaces) {
	for (const surface of surfaces) expect(String(surface)).not.toContain(MARKER);
	expect(loggedText()).not.toContain(MARKER);
}

function errorSurface(err) {
	const own = {};
	for (const name of Object.getOwnPropertyNames(err)) own[name] = err[name];
	return `${err.message}\n${err.stack}\n${JSON.stringify(own)}\n${err.cause ? `${err.cause.message}\n${JSON.stringify(err.cause)}` : ''}`;
}

function mockRes() {
	return {
		statusCode: 200,
		_headers: {},
		_body: '',
		setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
		getHeader(k) { return this._headers[k.toLowerCase()]; },
		end(b) { this._body = b || ''; },
		get json() { try { return JSON.parse(this._body); } catch { return null; } },
	};
}

function mockReq({ method = 'POST', url = '/api/forge', body = null, headers = {} } = {}) {
	const r = Readable.from(body != null ? [Buffer.from(JSON.stringify(body))] : []);
	r.method = method;
	r.url = url;
	r.headers = { origin: 'http://localhost:3000', 'content-type': 'application/json', ...headers };
	return r;
}

beforeEach(() => {
	vi.resetModules();
	process.env.NODE_ENV = 'development';
	delete process.env.HOLDER_PASS_SECRET;
	delete process.env.TRIPO_API_KEY;
	process.env.JWT_SECRET = 'byok-safety-test-secret-0123456789abcdef';
	logSpies = ['log', 'info', 'warn', 'error', 'debug'].map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});

afterEach(() => {
	globalThis.fetch = ORIGINAL_FETCH;
	for (const k of ENV_KEYS) {
		if (priorEnv[k] === undefined) delete process.env[k];
		else process.env[k] = priorEnv[k];
	}
	vi.restoreAllMocks();
});

async function registry() {
	return (await import('../api/_providers/byok-registry.js')).BYOK_PROVIDER_FACTORIES;
}

// What each adapter does to start a task, so one table drives every provider.
const START = {
	tripo: (gp) => gp.textToGeometry({ prompt: 'a brass lamp', tier: TIER }),
	meshy: (gp) => gp.textToGeometry({ prompt: 'a brass lamp', tier: TIER }),
	rodin: (gp) => gp.textToGeometry({ prompt: 'a brass lamp', tier: TIER }),
	stability: (gp) => gp.imageTo3d({ imageUrl: 'https://images.example.test/ref.png', tier: TIER }),
};

function answerFor(provider, upstream) {
	return (url) => {
		if (new URL(url).host === 'images.example.test') return new Response(new Uint8Array([137, 80, 78, 71, 1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } });
		return upstream(url);
	};
}

describe('the key never leaves through an error or a log, for every provider', () => {
	for (const provider of Object.keys(KEYS)) {
		const key = KEYS[provider];

		it(`${provider}: a provider that echoes the key in its 401 text is scrubbed`, async () => {
			stubFetch(answerFor(provider, () => jsonRes(401, { code: 1000, message: `Invalid API key ${key}`, error: `bad ${key}`, errors: [`key ${key}`] })));
			const gp = (await registry())[provider](key);
			const err = await START[provider](gp).catch((e) => e);
			expect(err).toBeInstanceOf(Error);
			expect(err.code).toBe('invalid_key');
			assertNoLeak(errorSurface(err));
		});

		it(`${provider}: a provider that echoes the key in a 500 body is scrubbed`, async () => {
			stubFetch(answerFor(provider, () => jsonRes(500, { code: 9000, message: `upstream fault, credential ${key} was used`, error: `fault ${key}`, errors: [`fault ${key}`] })));
			const gp = (await registry())[provider](key);
			const err = await START[provider](gp).catch((e) => e);
			expect(err).toBeInstanceOf(Error);
			assertNoLeak(errorSurface(err));
		});

		it(`${provider}: a network error that carries the Authorization header is scrubbed`, async () => {
			stubFetch(answerFor(provider, () => {
				throw new TypeError(`request failed {"authorization":"Bearer ${key}"} for ${key}`);
			}));
			const gp = (await registry())[provider](key);
			const err = await START[provider](gp).catch((e) => e);
			expect(err).toBeInstanceOf(Error);
			expect(err.code).toBe('provider_unreachable');
			assertNoLeak(errorSurface(err));
		});

		it(`${provider}: the key goes only to the provider's own host, only as a bearer header`, async () => {
			stubFetch(answerFor(provider, () => jsonRes(401, { message: 'no' })));
			const gp = (await registry())[provider](key);
			await START[provider](gp).catch(() => {});
			const providerCalls = calls.filter((c) => new URL(c.url).host !== 'images.example.test');
			expect(providerCalls.length).toBeGreaterThan(0);
			for (const { url, init } of calls) {
				const host = new URL(url).host;
				expect([HOSTS[provider], 'images.example.test']).toContain(host);
				expect(new URL(url).protocol).toBe('https:');
				expect(url).not.toContain(MARKER);
				if (host === 'images.example.test') {
					expect(JSON.stringify(init.headers || {})).not.toContain(MARKER);
				} else {
					expect(init.headers.authorization).toBe(`Bearer ${key}`);
					const others = { ...init.headers };
					delete others.authorization;
					expect(JSON.stringify(others)).not.toContain(MARKER);
				}
				if (typeof init.body === 'string') expect(init.body).not.toContain(MARKER);
			}
		});
	}

	for (const provider of ['tripo', 'meshy', 'rodin']) {
		const key = KEYS[provider];
		it(`${provider}: a task that fails with the key in its reason is scrubbed on the poll result`, async () => {
			stubFetch(() =>
				provider === 'tripo'
					? jsonRes(200, { code: 0, data: { status: 'failed', error_message: `task died for ${key}` } })
					: provider === 'meshy'
						? jsonRes(200, { status: 'FAILED', task_error: { message: `task died for ${key}` } })
						: jsonRes(200, { jobs: [{ status: 'Failed' }], error: `task died for ${key}` }),
			);
			const gp = (await registry())[provider](key);
			const result = await gp.status({ kind: provider === 'meshy' ? 'text-to-3d' : 'sub-key', taskId: 'task-1' });
			expect(result.status).toBe('failed');
			assertNoLeak(JSON.stringify(result));
		});
	}
});

describe('a user cannot redirect the key to another host', () => {
	for (const provider of ['tripo', 'meshy', 'rodin']) {
		it(`${provider}: base_url, api_base and host overrides in the request body are ignored`, async () => {
			process.env.NVIDIA_API_KEY = 'nvapi-not-used';
			stubFetch((url) => jsonRes(401, { message: 'no' }));
			const forge = (await import('../api/forge.js')).default;
			const res = mockRes();
			await forge(
				mockReq({
					body: {
						prompt: 'a brass lamp',
						backend: provider,
						tier: 'draft',
						base_url: 'https://evil.example.test',
						api_base: 'https://evil.example.test',
						provider_url: 'https://evil.example.test',
						host: 'evil.example.test',
					},
					headers: { 'x-forge-provider-key': KEYS[provider], host: 'evil.example.test', 'x-forwarded-host': 'evil.example.test' },
				}),
				res,
			);
			expect(calls.length).toBeGreaterThan(0);
			for (const { url, init } of calls) {
				expect(new URL(url).host).not.toContain('evil');
				expect(JSON.stringify(init.headers || {})).not.toContain('evil');
			}
			for (const { url } of calls) expect(new URL(url).host).toBe(HOSTS[provider]);
			assertNoLeak(res._body);
		});
	}
});

describe('a malformed key is refused before any billed call', () => {
	const cases = {
		'contains a line break (header injection)': (k) => `${k}\r\nx-injected: 1`,
		'contains a space': (k) => `${k} extra`,
		'has the wrong vendor prefix': () => `sk-ant-${MARKER}`,
		'is too short': () => 'tsk_ab',
		'has non-ASCII characters': (k) => `${k}é中`,
	};

	for (const [name, make] of Object.entries(cases)) {
		it(`tripo: a key that ${name} answers 401 invalid_key and starts nothing`, async () => {
			process.env.NVIDIA_API_KEY = 'nvapi-not-used';
			stubFetch(() => jsonRes(200, { code: 0, data: { task_id: 'should-never-start' } }));
			const forge = (await import('../api/forge.js')).default;
			const res = mockRes();
			const badKey = make(KEYS.tripo);
			// A header cannot carry a line break, so that case arrives in the body.
			const viaBody = /[\r\n\u0080-￿]/.test(badKey);
			await forge(
				mockReq({
					body: { prompt: 'a brass lamp', backend: 'tripo', tier: 'draft', ...(viaBody ? { provider_key: badKey } : {}) },
					headers: viaBody ? {} : { 'x-forge-provider-key': badKey },
				}),
				res,
			);
			expect(res.statusCode).toBe(401);
			expect(res.json.error).toBe('invalid_key');
			expect(res.json.message).toMatch(/key/i);
			expect(calls.length).toBe(0);
			assertNoLeak(res._body);
			expect(res._body).not.toContain(badKey);
		});
	}

	it('a malformed key never falls through to the platform house key', async () => {
		process.env.TRIPO_API_KEY = 'tsk_HOUSE_KEY_THE_PLATFORM_PAYS_WITH_0001';
		stubFetch(() => jsonRes(200, { code: 0, data: { task_id: 'house-task' } }));
		const forge = (await import('../api/forge.js')).default;
		const res = mockRes();
		await forge(
			mockReq({ body: { prompt: 'a brass lamp', backend: 'tripo', tier: 'draft' }, headers: { 'x-forge-provider-key': 'not a key' } }),
			res,
		);
		expect(res.statusCode).toBe(401);
		expect(res.json.error).toBe('invalid_key');
		expect(calls.length).toBe(0);
	});

	it('the resolver reports a malformed inline key as rejected and never returns the house key', async () => {
		process.env.TRIPO_API_KEY = 'tsk_HOUSE_KEY_THE_PLATFORM_PAYS_WITH_0001';
		const { resolveProviderKeyWithSource, resolveProviderKey } = await import('../api/_lib/forge-provider-key.js');
		const found = await resolveProviderKeyWithSource({ headers: { 'x-forge-provider-key': 'has a space' } }, null, 'tripo');
		expect(found.key).toBeNull();
		expect(found.source).toBeNull();
		expect(found.rejected?.reason).toBe('whitespace');
		expect(await resolveProviderKey({ headers: { 'x-forge-provider-key': 'has a space' } }, null, 'tripo')).toBeNull();
	});

	it('a well-formed key for every provider passes the shape check', async () => {
		const { keyShapeProblem } = await import('../api/_lib/forge-byok-guard.js');
		for (const [provider, key] of Object.entries(KEYS)) expect(keyShapeProblem(provider, key)).toBeNull();
		expect(keyShapeProblem('replicate', 'r8_0123456789abcdefghijklmnop')).toBeNull();
	});

	it('the shape table agrees with the Account key registry', async () => {
		const { KEY_SHAPES } = await import('../api/_lib/forge-byok-guard.js');
		const { BYOK_PROVIDERS } = await import('../api/_lib/provider-keys.js');
		for (const [provider, shape] of Object.entries(KEY_SHAPES)) {
			expect(BYOK_PROVIDERS[provider]?.prefix, provider).toBe(shape.prefix);
		}
	});
});

describe('each failure class has its own code and message, and no silent platform swap', () => {
	async function submit(upstream, provider = 'meshy') {
		process.env.NVIDIA_API_KEY = 'nvapi-would-serve-a-silent-fallback';
		stubFetch((url) => {
			if (new URL(url).host === HOSTS[provider]) return upstream(url);
			return jsonRes(200, { status: 'unexpected platform call' });
		});
		const forge = (await import('../api/forge.js')).default;
		const res = mockRes();
		await forge(
			mockReq({ body: { prompt: 'a brass lamp', backend: provider, tier: 'draft' }, headers: { 'x-forge-provider-key': KEYS[provider] } }),
			res,
		);
		const platformCalls = calls.filter((c) => new URL(c.url).host !== HOSTS[provider]);
		return { res, platformCalls };
	}

	it('invalid key: 401 invalid_key that names the provider', async () => {
		const { res, platformCalls } = await submit(() => jsonRes(401, { message: 'unauthorized' }));
		expect(res.statusCode).toBe(401);
		expect(res.json.error).toBe('invalid_key');
		expect(res.json.message).toMatch(/Meshy/);
		expect(platformCalls).toEqual([]);
		assertNoLeak(res._body);
	});

	it('out of credits: 402 insufficient_credits that names the user account', async () => {
		const { res, platformCalls } = await submit(() => jsonRes(402, { message: 'no credits' }));
		expect(res.statusCode).toBe(402);
		expect(res.json.error).toBe('insufficient_credits');
		expect(res.json.message).toMatch(/Your Meshy account/);
		expect(platformCalls).toEqual([]);
	});

	it('throttled: 429 rate_limited with a retry-after that says it is the user key', async () => {
		const { res, platformCalls } = await submit(() => jsonRes(429, { message: 'slow down' }));
		expect(res.statusCode).toBe(429);
		expect(res.json.error).toBe('rate_limited');
		expect(res.json.message).toMatch(/your key/i);
		expect(Number(res.getHeader('retry-after'))).toBeGreaterThan(0);
		expect(platformCalls).toEqual([]);
	});

	it('provider down: 503 provider_unavailable, and the free platform engine is NOT started instead', async () => {
		const { res, platformCalls } = await submit(() => jsonRes(503, { message: 'maintenance' }));
		expect(res.statusCode).toBe(503);
		expect(res.json.error).toBe('provider_unavailable');
		expect(res.json.message).toMatch(/Meshy/);
		expect(res.json.message).toMatch(/different engine|another engine|pick/i);
		expect(platformCalls).toEqual([]);
		expect(Number(res.getHeader('retry-after'))).toBeGreaterThan(0);
	});

	it('provider unreachable: the same honest 503, never the free platform engine', async () => {
		const { res, platformCalls } = await submit(() => {
			throw new TypeError('fetch failed');
		});
		expect(res.statusCode).toBe(503);
		expect(res.json.error).toBe('provider_unavailable');
		expect(platformCalls).toEqual([]);
	});

	it('content refused: 422 content_refused, not "invalid key"', async () => {
		const { res } = await submit(() => jsonRes(403, { name: 'content_moderation', errors: ['Your request was flagged by our content moderation system.'] }), 'tripo');
		expect(res.statusCode).toBe(422);
		expect(res.json.error).toBe('content_refused');
		expect(res.json.message).toMatch(/content/i);
	});
});

describe('a job that fails after it started is explained, not masked as a platform outage', () => {
	async function poll(provider, upstream, kind = 'text-to-3d') {
		stubFetch(() => upstream());
		const { encodeJobToken } = await import('../api/_lib/forge-job-token.js');
		const forge = (await import('../api/forge.js')).default;
		const res = mockRes();
		const job = encodeJobToken({ provider, kind, taskId: 'task-9' });
		await forge(
			mockReq({ method: 'GET', url: `/api/forge?job=${encodeURIComponent(job)}`, headers: { 'x-forge-provider-key': KEYS[provider] } }),
			res,
		);
		return res;
	}

	it('a key revoked mid-job ends the job as invalid_key instead of spinning forever', async () => {
		const res = await poll('meshy', () => jsonRes(401, { message: 'unauthorized' }));
		expect(res.json.status).toBe('failed');
		expect(res.json.error_code).toBe('invalid_key');
		expect(res.json.error).toMatch(/Meshy rejected your API key/);
	});

	it('credits running out mid-job names the user account, not "temporarily unavailable"', async () => {
		const res = await poll('meshy', () => jsonRes(200, { status: 'FAILED', task_error: { message: 'Insufficient credits to complete this task' } }));
		expect(res.json.status).toBe('failed');
		expect(res.json.error_code).toBe('insufficient_credits');
		expect(res.json.error).toMatch(/Your Meshy account/);
		expect(res.json.error).not.toMatch(/temporarily unavailable/i);
	});

	it('a content refusal mid-job is reported as one', async () => {
		const res = await poll('tripo', () => jsonRes(200, { code: 0, data: { status: 'failed', error_message: 'Task rejected by content policy' } }), 'task');
		expect(res.json.status).toBe('failed');
		expect(res.json.error_code).toBe('content_refused');
	});

	it('an unclassified provider reason is relayed with the key scrubbed out', async () => {
		const res = await poll('meshy', () => jsonRes(200, { status: 'FAILED', task_error: { message: `mesh failed to converge for ${KEYS.meshy}` } }));
		expect(res.json.status).toBe('failed');
		expect(res.json.error_code).toBe('task_failed');
		expect(res.json.error).toMatch(/Meshy could not finish/);
		assertNoLeak(res._body);
	});

	it('a provider outage mid-job keeps the job running so the page retries', async () => {
		const res = await poll('meshy', () => jsonRes(503, { message: 'maintenance' }));
		expect(res.json.status).toBe('running');
	});

	it('a job started on the platform Tripo key is polled with that key, not failed for want of one', async () => {
		process.env.TRIPO_API_KEY = 'tsk_HOUSE_KEY_THE_PLATFORM_PAYS_WITH_0001';
		stubFetch(() => jsonRes(200, { code: 0, data: { status: 'running', progress: 40 } }));
		const { encodeJobToken } = await import('../api/_lib/forge-job-token.js');
		const forge = (await import('../api/forge.js')).default;
		const res = mockRes();
		await forge(
			mockReq({ method: 'GET', url: `/api/forge?job=${encodeURIComponent(encodeJobToken({ provider: 'tripo', kind: 'task', taskId: 'task-house' }))}` }),
			res,
		);
		expect(res.json.status).toBe('running');
		expect(calls[0].init.headers.authorization).toBe('Bearer tsk_HOUSE_KEY_THE_PLATFORM_PAYS_WITH_0001');
	});

	it('a house-key job that fails is not blamed on the caller key', async () => {
		process.env.TRIPO_API_KEY = 'tsk_HOUSE_KEY_THE_PLATFORM_PAYS_WITH_0001';
		stubFetch(() => jsonRes(200, { code: 0, data: { status: 'failed', error_message: 'Insufficient credits' } }));
		const { encodeJobToken } = await import('../api/_lib/forge-job-token.js');
		const forge = (await import('../api/forge.js')).default;
		const res = mockRes();
		await forge(
			mockReq({ method: 'GET', url: `/api/forge?job=${encodeURIComponent(encodeJobToken({ provider: 'tripo', kind: 'task', taskId: 'task-house' }))}` }),
			res,
		);
		expect(res.json.status).toBe('failed');
		expect(res.json.error).not.toMatch(/Your Tripo account/);
	});
});
