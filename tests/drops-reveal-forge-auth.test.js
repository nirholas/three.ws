// Revealing a drop item generates a model through /api/forge, which refuses a
// caller with no account. The reveal is already signed in, so it must carry the
// revealer's own credential to /api/forge; otherwise every reveal fails with
// sign_in_required and the item is handed straight back unrevealed.

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { Readable } from 'node:stream';

vi.mock('../api/_lib/auth.js', async (orig) => ({
	...(await orig()),
	getSessionUser: async () => ({ id: 'visitor-1' }),
	authenticateBearer: async () => null,
	extractBearer: () => null,
}));
const attached = [];
vi.mock('../api/_lib/drop-store.js', async (orig) => ({
	...(await orig()),
	dropsConfigured: () => true,
	getDropBySlug: async () => ({
		id: 'd1', slug: 'neon', status: 'live', supply: 10, style: 'neon',
		layers: [{ name: 'Finish', options: ['Gold', 'Obsidian'] }],
		is_owner: false, public_opens_at: null,
	}),
	claimForReveal: async () => ({ index: 0, status: 'revealing', traits: [{ layer: 'finish', value: 'Gold' }] }),
	attachForgeJob: async (...args) => { attached.push(args); },
	markRevealFailed: async () => ({ index: 0, status: 'sealed' }),
}));

let handler;

function mockRes() {
	return {
		statusCode: 200, _headers: {}, _body: '',
		setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
		getHeader(k) { return this._headers[k.toLowerCase()]; },
		end(b) { this._body = b || ''; },
		get json() { try { return JSON.parse(this._body); } catch { return null; } },
	};
}
function mockReq(body, headers = {}) {
	const r = Readable.from([Buffer.from(JSON.stringify(body))]);
	r.method = 'POST';
	r.url = '/api/drops/reveal';
	r.query = { action: 'reveal' };
	r.headers = { origin: 'http://localhost:3000', host: 'localhost:3000', 'content-type': 'application/json', ...headers };
	return r;
}

beforeAll(async () => {
	process.env.NODE_ENV = 'development';
	handler = (await import('../api/drops/[action].js')).default;
});
afterEach(() => vi.unstubAllGlobals());

describe('POST /api/drops/reveal forge submit', () => {
	it("carries the revealer's session to /api/forge", async () => {
		const fetchMock = vi.fn(async () => ({ ok: true, status: 202, json: async () => ({ job_id: 'f1.job', status: 'queued' }) }));
		vi.stubGlobal('fetch', fetchMock);
		const res = mockRes();
		await handler(mockReq({ slug: 'neon', index: 0 }, { cookie: '__Host-sid=reveal' }), res);
		expect(res.json).toMatchObject({ job_id: "f1.job" });
		expect(res.statusCode).toBe(202);
		const [url, init] = fetchMock.mock.calls.find(([u]) => /\/api\/forge$/.test(u));
		expect(url).toMatch(/\/api\/forge$/);
		expect(init.headers.cookie).toBe('__Host-sid=reveal');
		expect(init.headers['x-forge-client']).toBe('drop-d1');
		expect(attached.at(-1)).toEqual(['d1', 0, 'f1.job']);
	});
});
