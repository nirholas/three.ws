// Handler-shape tests for api/pump-bounties.js and api/pump-bounties/stats.js.
//
// Production 2026-10-24: pump.fun's Cloudflare anti-bot challenge rejected
// livestream-api.pump.fun/bounties/tasks (a "Just a moment..." 403, surfaced
// here as a PumpGoError) for hours at a time. Neither route had a last-known-
// good fallback, so every single sample in the 24h log window 502'd even
// though the bounty board itself had not changed. These pin the fix: a
// long-lived cache entry written on every real success, served (marked
// `stale: true`) instead of a 502 when the live fetch fails and the short
// cache has already expired.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { publicIp: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })) },
	clientIp: () => '203.0.113.1',
}));

const store = new Map();
vi.mock('../api/_lib/cache.js', () => ({
	cacheGet: vi.fn(async (k) => (store.has(k) ? store.get(k) : null)),
	cacheSet: vi.fn(async (k, v) => { store.set(k, v); }),
}));

const listBounties = vi.fn();
vi.mock('../api/_lib/pump-go.js', async () => {
	const actual = await vi.importActual('../api/_lib/pump-go.js');
	return { ...actual, listBounties };
});

function makeReqRes(url) {
	const req = { method: 'GET', url, headers: {} };
	const res = {
		statusCode: 200,
		headers: {},
		body: '',
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		getHeader(k) { return this.headers[k.toLowerCase()]; },
		end(b) { this.body = b ?? ''; },
	};
	return { req, res };
}

beforeEach(() => {
	store.clear();
	listBounties.mockReset();
});

describe('GET /api/pump-bounties: last-known-good fallback', () => {
	it('propagates the upstream failure when no last-known-good copy exists', async () => {
		const { default: handler } = await import('../api/pump-bounties.js');
		const { PumpGoError } = await import('../api/_lib/pump-go.js');
		listBounties.mockRejectedValue(new PumpGoError('pump.fun GO upstream 403', 502, 'pump_go_upstream'));

		const { req, res } = makeReqRes('/api/pump-bounties?limit=30');
		await handler(req, res);
		expect(res.statusCode).toBe(502);
	});

	it('serves the last-known-good list, marked stale, instead of a 502', async () => {
		const { default: handler } = await import('../api/pump-bounties.js');
		const { PumpGoError } = await import('../api/_lib/pump-go.js');

		listBounties.mockResolvedValueOnce({ items: [{ taskId: 't1' }], nextCursor: null });
		const warm = makeReqRes('/api/pump-bounties?limit=30');
		await handler(warm.req, warm.res);
		expect(warm.res.statusCode).toBe(200);
		// Expire the short-TTL live cache (the real one lapses after 30s) while
		// leaving the long-TTL last-known-good copy in place.
		store.delete('pumpgo:list:30:_:_');

		listBounties.mockRejectedValueOnce(new PumpGoError('pump.fun GO upstream 403', 502, 'pump_go_upstream'));
		const { req, res } = makeReqRes('/api/pump-bounties?limit=30');
		await handler(req, res);
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body.stale).toBe(true);
		expect(body.items).toEqual([{ taskId: 't1' }]);
	});
});

describe('GET /api/pump-bounties/stats: last-known-good fallback', () => {
	it('propagates the upstream failure when no last-known-good copy exists', async () => {
		const { default: handler } = await import('../api/pump-bounties/stats.js');
		const { PumpGoError } = await import('../api/_lib/pump-go.js');
		listBounties.mockRejectedValue(new PumpGoError('pump.fun GO upstream 403', 502, 'pump_go_upstream'));

		const { req, res } = makeReqRes('/api/pump-bounties/stats');
		await handler(req, res);
		expect(res.statusCode).toBe(502);
	});

	it('serves the last-known-good totals, marked stale, instead of a 502', async () => {
		const { default: handler } = await import('../api/pump-bounties/stats.js');
		const { PumpGoError } = await import('../api/_lib/pump-go.js');

		listBounties.mockResolvedValueOnce({
			items: [{ reward: { totalUsd: 10 }, counts: { submissions: 2 }, likeCount: 1 }],
			nextCursor: null,
		});
		const warm = makeReqRes('/api/pump-bounties/stats');
		await handler(warm.req, warm.res);
		expect(warm.res.statusCode).toBe(200);
		expect(JSON.parse(warm.res.body).count).toBe(1);
		store.delete('pumpgo:stats:v1');

		listBounties.mockRejectedValueOnce(new PumpGoError('pump.fun GO upstream 403', 502, 'pump_go_upstream'));
		const { req, res } = makeReqRes('/api/pump-bounties/stats');
		await handler(req, res);
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body.stale).toBe(true);
		expect(body.count).toBe(1);
	});
});
