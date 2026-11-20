// POST /api/forge-batch fans out to /api/forge, so it carries the same account
// rule: an anonymous caller is refused before any item is submitted, and a
// signed-in caller's own credential (cookie or API-key bearer) rides on every
// item so /api/forge gates and attributes each model to that same person.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Readable } from 'node:stream';

let signedIn = { id: 'user-batch' };
vi.mock('../api/_lib/auth.js', async (orig) => ({
	...(await orig()),
	getRequestUser: async () => signedIn,
}));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: {
		forgeBatchSubmit: vi.fn(async () => ({ success: true })),
		forgeBatchStatus: vi.fn(async () => ({ success: true })),
	},
	clientIp: vi.fn(() => '203.0.113.9'),
}));
vi.mock('../api/_lib/redis.js', () => ({ getRedis: () => null }));
vi.mock('../api/_lib/comp-access.js', () => ({
	resolveCompAccess: async () => ({ comped: false }),
	COMP_TIER: { rateMultiplier: 1 },
}));

const { default: handler } = await import('../api/forge-batch.js');
const { limits } = await import('../api/_lib/rate-limit.js');

function mockReq(body, headers = {}) {
	const r = Readable.from([Buffer.from(JSON.stringify(body))]);
	r.method = 'POST';
	r.url = '/api/forge-batch';
	r.headers = { host: 'three.ws', 'x-forwarded-proto': 'https', 'content-type': 'application/json', ...headers };
	return r;
}
function mockRes() {
	return {
		statusCode: 200,
		headers: {},
		body: '',
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		getHeader(k) { return this.headers[k.toLowerCase()]; },
		end(b) { this.body = b || ''; },
		get json() { return JSON.parse(this.body || '{}'); },
	};
}

describe('POST /api/forge-batch account gate', () => {
	let fetchMock;
	beforeEach(() => {
		signedIn = { id: 'user-batch' };
		fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ job_id: 'f1.x', status: 'queued' }) }));
		vi.stubGlobal('fetch', fetchMock);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('answers an anonymous caller 401 sign_in_required and submits nothing', async () => {
		signedIn = null;
		const res = mockRes();
		await handler(mockReq({ items: [{ prompt: 'a lamp' }, { prompt: 'a chair' }] }), res);
		expect(res.statusCode).toBe(401);
		expect(res.json).toMatchObject({ error: 'sign_in_required', api_keys_url: '/dashboard/api-keys' });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('forwards an API-key bearer to every /api/forge item', async () => {
		const res = mockRes();
		await handler(mockReq({ items: [{ prompt: 'a lamp' }, { prompt: 'a chair' }] }, { authorization: 'Bearer sk_live_test' }), res);
		expect(res.statusCode).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		for (const [url, init] of fetchMock.mock.calls) {
			expect(url).toMatch(/\/api\/forge$/);
			expect(init.headers.authorization).toBe('Bearer sk_live_test');
		}
	});

	it('keys the submit rate limit on the account', async () => {
		const res = mockRes();
		await handler(mockReq({ items: [{ prompt: 'a lamp' }] }, { cookie: '__Host-sid=s' }), res);
		expect(limits.forgeBatchSubmit).toHaveBeenLastCalledWith('user:user-batch', 1);
		expect(fetchMock.mock.calls[0][1].headers.cookie).toBe('__Host-sid=s');
	});
});
