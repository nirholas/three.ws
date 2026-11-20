// Making a 3D model needs an account. POST /api/forge (text→3D, image→3D and
// ?action=rig) used to accept anyone, so the platform was a free, unaccountable
// generator: nothing tied a model to a person. These tests pin the gate in
// api/_lib/creator-account.js as /api/forge applies it:
//   • no account                → 401 sign_in_required, before any provider work
//   • signed-in (bearer/session) → past the gate
//   • platform job (seed token)  → past the gate
//   • on-behalf user header      → honoured only beside the seed token
// Polling, the catalog and health stay open.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { Readable } from 'node:stream';

const auth = { user: null };
vi.mock('../api/_lib/auth.js', async (orig) => ({
	...(await orig()),
	getRequestUser: async () => auth.user,
	getSessionUser: async () => auth.user,
}));

let forge;
let creator;

function mockRes() {
	return {
		statusCode: 200, _headers: {}, _body: '',
		setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
		getHeader(k) { return this._headers[k.toLowerCase()]; },
		end(b) { this._body = b || ''; },
		get json() { try { return JSON.parse(this._body); } catch { return null; } },
	};
}

function mockReq({ body = null, headers = {}, url = '/api/forge', method = 'POST' } = {}) {
	const r = Readable.from(body != null ? [Buffer.from(JSON.stringify(body))] : []);
	r.method = method;
	r.url = url;
	r.headers = { origin: 'http://localhost:3000', 'content-type': 'application/json', ...headers };
	return r;
}

beforeAll(async () => {
	process.env.NODE_ENV = 'development';
	process.env.CRON_SECRET = 'seed-secret-for-tests';
	delete process.env.REPLICATE_API_TOKEN;
	forge = (await import('../api/forge.js')).default;
	creator = await import('../api/_lib/creator-account.js');
});

beforeEach(() => {
	auth.user = null;
});

describe('POST /api/forge needs an account', () => {
	it('refuses an anonymous text prompt with sign_in_required', async () => {
		const res = mockRes();
		await forge(mockReq({ body: { prompt: 'a brass telescope' } }), res);
		expect(res.statusCode).toBe(401);
		expect(res.json).toMatchObject({ error: 'sign_in_required', sign_in_url: '/login', api_keys_url: '/dashboard/api-keys' });
		expect(res.json.message).toMatch(/Sign in to make a 3D model/);
		expect(res._headers['www-authenticate']).toMatch(/^Bearer /);
	});

	it('refuses an anonymous image reconstruction and an anonymous rig', async () => {
		let res = mockRes();
		await forge(mockReq({ body: { image_urls: ['https://example.com/a.png'] } }), res);
		expect(res.statusCode).toBe(401);

		res = mockRes();
		await forge(mockReq({ url: '/api/forge?action=rig', body: { glb_url: 'https://example.com/a.glb' } }), res);
		expect(res.statusCode).toBe(401);
		expect(res.json.message).toMatch(/Sign in to rig a 3D model/);
	});

	it('lets a signed-in account past the gate', async () => {
		auth.user = { id: 'user-1' };
		const res = mockRes();
		await forge(mockReq({ body: { prompt: 'a brass telescope' } }), res);
		expect(res.statusCode).not.toBe(401);
	});

	it('lets a platform job past the gate with the seed token', async () => {
		const res = mockRes();
		await forge(mockReq({ body: { prompt: 'a brass telescope' }, headers: { 'x-forge-seed': 'seed-secret-for-tests' } }), res);
		expect(res.statusCode).not.toBe(401);
	});

	it('refuses a wrong seed token', async () => {
		const res = mockRes();
		await forge(mockReq({ body: { prompt: 'a brass telescope' }, headers: { 'x-forge-seed': 'guess' } }), res);
		expect(res.statusCode).toBe(401);
	});

	it('keeps polling and the catalog open', async () => {
		const res = mockRes();
		await forge(mockReq({ method: 'GET', url: '/api/forge?catalog' }), res);
		expect(res.statusCode).toBe(200);
	});
});

describe('creator-account', () => {
	it('honours x-forge-on-behalf-user only beside the seed token', async () => {
		const spoof = mockReq({ headers: { 'x-forge-on-behalf-user': 'victim' } });
		expect((await creator.resolveCreator(spoof)).user).toBeNull();

		const trusted = mockReq({ headers: { 'x-forge-seed': 'seed-secret-for-tests', 'x-forge-on-behalf-user': 'user-9' } });
		const who = await creator.resolveCreator(trusted);
		expect(who.platform).toBe(true);
		expect(who.user).toMatchObject({ id: 'user-9' });
	});

	it('forwards only the caller credential headers', () => {
		const out = creator.forwardCreatorAuth({ headers: { cookie: 'sid=1', authorization: 'Bearer k', 'x-forge-seed': 'nope', host: 'x' } });
		expect(out).toEqual({ cookie: 'sid=1', authorization: 'Bearer k' });
	});

	it('marks platform jobs that act for a person as on-behalf', () => {
		expect(creator.platformAuthHeaders({ userId: 'user-3' })).toEqual({
			'x-forge-seed': 'seed-secret-for-tests',
			'x-forge-on-behalf': '1',
			'x-forge-on-behalf-user': 'user-3',
		});
		expect(creator.platformAuthHeaders({ onBehalf: false })).toEqual({ 'x-forge-seed': 'seed-secret-for-tests' });
	});
});
