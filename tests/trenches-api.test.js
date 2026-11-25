// Coverage for api/trenches.js, the read-only proxy in front of services/pulse.
// Hard requirement: never fabricate market data. Unconfigured or failing
// upstream with no earlier real answer is 503 pulse_offline; only allowlisted
// views and params pass. A real answer Pulse gave earlier may be served while it
// is stalled or failing, always marked stale with its age and never CDN-cached
// (2026-11-25: Pulse stalled for ~50s and the whole Trenches page went offline).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../api/_lib/http.js', () => ({
	wrap: (fn) => fn,
	cors: () => false,
	method: () => true,
	rateLimited: (res) => {
		res._json = { status: 429, body: { error: 'rate_limited' } };
		return res;
	},
	json: (res, status, body, headers = {}) => {
		res._json = { status, body, headers };
		return res;
	},
}));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { marketDataIp: vi.fn(async () => ({ success: true })) },
	clientIp: () => '1.2.3.4',
}));

const { default: handler } = await import('../api/trenches.js');
const { limits } = await import('../api/_lib/rate-limit.js');

const call = (url) => {
	const res = { setHeader() {}, end() {}, statusCode: 200 };
	return handler({ method: 'GET', url, headers: {} }, res).then(() => res._json);
};

const ORIGINAL = process.env.PULSE_URL;
const originalFetch = global.fetch;

beforeEach(() => {
	limits.marketDataIp.mockResolvedValue({ success: true });
	process.env.PULSE_URL = 'https://pulse.example.test';
	global.fetch = vi.fn();
});
afterEach(() => {
	if (ORIGINAL === undefined) delete process.env.PULSE_URL;
	else process.env.PULSE_URL = ORIGINAL;
	global.fetch = originalFetch;
});

describe('api/trenches', () => {
	it('503s pulse_offline when PULSE_URL is unset', async () => {
		delete process.env.PULSE_URL;
		const r = await call('/api/trenches?view=overview');
		expect(r.status).toBe(503);
		expect(r.body.error).toBe('pulse_offline');
		expect(global.fetch).not.toHaveBeenCalled();
	});

	it('rejects unknown views with 400', async () => {
		const r = await call('/api/trenches?view=../../etc/passwd');
		expect(r.status).toBe(400);
		expect(global.fetch).not.toHaveBeenCalled();
	});

	it('forwards only allowlisted params to the mapped upstream path', async () => {
		global.fetch.mockResolvedValue({ ok: true, json: async () => ({ total: 0, rows: [] }) });
		const r = await call('/api/trenches?view=tokens&chain=solana&limit=5&secret=1');
		const upstream = global.fetch.mock.calls[0][0];
		expect(upstream.pathname).toBe('/api/tokens');
		expect(upstream.searchParams.get('chain')).toBe('solana');
		expect(upstream.searchParams.get('limit')).toBe('5');
		expect(upstream.searchParams.has('secret')).toBe(false);
		expect(r.status).toBe(200);
		expect(r.body).toEqual({ total: 0, rows: [] });
	});

	it('503s on non-2xx upstream and on network failure, never with data', async () => {
		global.fetch.mockResolvedValueOnce({ ok: false, status: 500 });
		expect((await call('/api/trenches?view=launches')).body.error).toBe('pulse_offline');
		global.fetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
		const r = await call('/api/trenches?view=launches');
		expect(r.status).toBe(503);
		expect(r.headers['cache-control']).toBe('no-store');
	});

	it('serves the last real answer, marked stale, when Pulse fails after answering', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		try {
			vi.setSystemTime(new Date('2026-11-25T14:00:00Z'));
			global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ rows: [{ token: 'THREEsynthetic1111' }] }) });
			const first = await call('/api/trenches?view=launches&limit=7');
			expect(first.status).toBe(200);
			expect(first.headers['x-trenches-stale']).toBeUndefined();

			// Past the fresh window, Pulse fails.
			vi.setSystemTime(new Date('2026-11-25T14:05:00Z'));
			global.fetch.mockRejectedValueOnce(new Error('ECONNRESET'));
			const r = await call('/api/trenches?view=launches&limit=7');
			expect(r.status).toBe(200);
			expect(r.body).toEqual({ rows: [{ token: 'THREEsynthetic1111' }] });
			expect(r.headers['x-trenches-stale']).toBe('1');
			expect(r.headers['x-trenches-as-of']).toBe('2026-11-25T14:00:00.000Z');
			expect(r.headers['cache-control']).toBe('no-store');
		} finally {
			vi.useRealTimers();
		}
	});

	it('serves the last real answer instead of holding the page while Pulse is stalled', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		try {
			vi.setSystemTime(new Date('2026-11-25T15:00:00Z'));
			global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ stream: { launches1h: 4 } }) });
			await call('/api/trenches?view=overview');
			vi.setSystemTime(new Date('2026-11-25T15:05:00Z'));
			// A stalled Pulse: the request never settles within the budget.
			global.fetch.mockImplementationOnce(() => new Promise(() => {}));
			const started = performance.now();
			const r = await call('/api/trenches?view=overview');
			expect(r.status).toBe(200);
			expect(r.body).toEqual({ stream: { launches1h: 4 } });
			expect(r.headers['x-trenches-stale']).toBe('1');
			// Answered on the refresh budget, well before the fetch's own timeout.
			expect(performance.now() - started).toBeLessThan(6000);
		} finally {
			vi.useRealTimers();
		}
	}, 15_000);

	it('still 503s when Pulse fails and there is no earlier real answer', async () => {
		global.fetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
		const r = await call('/api/trenches?view=tokens&q=never-answered');
		expect(r.status).toBe(503);
		expect(r.body.error).toBe('pulse_offline');
	});

	it('honours the rate limit', async () => {
		limits.marketDataIp.mockResolvedValue({ success: false });
		expect((await call('/api/trenches?view=overview')).status).toBe(429);
	});
});
