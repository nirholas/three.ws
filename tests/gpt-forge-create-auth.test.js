// /api/gpt-forge (the ChatGPT clone of /api/forge) needs an account to make or
// rig a model, exactly like /api/forge: it used to be a public, auth-free twin,
// which left an anonymous generator open beside the gated one. The clone client
// (api/_mcp-studio/gpt-forge-client.js) carries the caller's credential or the
// platform-job headers on every submit and reports a refusal as a coded
// sign_in_required failure with the sign-in and API-key pointers.

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { Readable } from 'node:stream';

const auth = { user: null };
vi.mock('../api/_lib/auth.js', async (orig) => ({
	...(await orig()),
	getRequestUser: async () => auth.user,
	getSessionUser: async () => auth.user,
}));

let gptForge;
let client;

function mockRes() {
	return {
		statusCode: 200, _headers: {}, _body: '',
		setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
		getHeader(k) { return this._headers[k.toLowerCase()]; },
		end(b) { this._body = b || ''; },
		get json() { try { return JSON.parse(this._body); } catch { return null; } },
	};
}

function mockReq({ body = null, headers = {}, url = '/api/gpt-forge', method = 'POST' } = {}) {
	const r = Readable.from(body != null ? [Buffer.from(JSON.stringify(body))] : []);
	r.method = method;
	r.url = url;
	r.headers = { origin: 'http://localhost:3000', 'content-type': 'application/json', ...headers };
	return r;
}

function respond(status, body) {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeAll(async () => {
	process.env.NODE_ENV = 'development';
	process.env.CRON_SECRET = 'seed-secret-for-tests';
	delete process.env.REPLICATE_API_TOKEN;
	gptForge = (await import('../api/gpt-forge.js')).default;
	client = await import('../api/_mcp-studio/gpt-forge-client.js');
});

beforeEach(() => {
	auth.user = null;
});

afterEach(() => vi.unstubAllGlobals());

describe('POST /api/gpt-forge needs an account', () => {
	it('refuses an anonymous prompt and an anonymous rig with sign_in_required', async () => {
		let res = mockRes();
		await gptForge(mockReq({ body: { prompt: 'a brass telescope' } }), res);
		expect(res.statusCode).toBe(401);
		expect(res.json).toMatchObject({ error: 'sign_in_required', sign_in_url: '/login', api_keys_url: '/dashboard/api-keys' });

		res = mockRes();
		await gptForge(mockReq({ url: '/api/gpt-forge?action=rig', body: { glb_url: 'https://example.com/a.glb' } }), res);
		expect(res.statusCode).toBe(401);
		expect(res.json.message).toMatch(/Sign in to rig a 3D model/);
	});

	it('lets a signed-in account and a platform job past the gate', async () => {
		auth.user = { id: 'user-1' };
		let res = mockRes();
		await gptForge(mockReq({ body: { prompt: 'a brass telescope' } }), res);
		expect(res.statusCode).not.toBe(401);

		auth.user = null;
		res = mockRes();
		await gptForge(mockReq({ body: { prompt: 'a brass telescope' }, headers: { 'x-forge-seed': 'seed-secret-for-tests' } }), res);
		expect(res.statusCode).not.toBe(401);
	});

	it('keeps the catalog open', async () => {
		const res = mockRes();
		await gptForge(mockReq({ method: 'GET', url: '/api/gpt-forge?catalog' }), res);
		expect(res.statusCode).toBe(200);
	});
});

describe('gpt-forge-client carries the caller', () => {
	it('forwards the person credential on a submit and a rig', async () => {
		const seen = [];
		vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
			seen.push(init.headers);
			return respond(202, { status: 'queued', job_id: 'job-1' });
		}));
		const bearer = { authorization: 'Bearer tw_key' };
		await client.startForge('https://three.ws', { prompt: 'a lamp', auth: bearer });
		await client.startRig('https://three.ws', 'https://three.ws/a.glb', { auth: bearer });
		expect(seen[0].authorization).toBe('Bearer tw_key');
		expect(seen[1].authorization).toBe('Bearer tw_key');
		expect(seen[0]['x-forge-seed']).toBeUndefined();
	});

	it('marks a person-funded internal submit on-behalf so the model stays theirs', async () => {
		let headers;
		vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
			headers = init.headers;
			return respond(202, { status: 'queued', job_id: 'job-1' });
		}));
		await client.startForge('https://three.ws', { prompt: 'a lamp', tier: 'high', internal: true, auth: { cookie: 'sid=1' } });
		expect(headers).toMatchObject({ cookie: 'sid=1', 'x-forge-seed': 'seed-secret-for-tests', 'x-forge-on-behalf': '1' });
	});

	it('turns a 401 into a coded sign_in_required failure', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => respond(401, { error: 'sign_in_required', message: 'Sign in to make a 3D model. A three.ws account is free.' })));
		await expect(client.startForge('https://three.ws', { prompt: 'a lamp' })).rejects.toMatchObject({
			code: 'sign_in_required',
			status: 401,
			signInUrl: '/login',
			apiKeysUrl: '/dashboard/api-keys',
		});
		await expect(client.startRig('https://three.ws', 'https://three.ws/a.glb')).rejects.toMatchObject({ code: 'sign_in_required' });
	});
});
