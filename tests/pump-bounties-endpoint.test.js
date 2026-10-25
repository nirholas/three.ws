// Route-level tests for the three api/pump-bounties* handlers after they moved
// onto cacheWrapLastGood (api/_lib/cache.js). Production 2026-10-24: pump.fun's
// Cloudflare anti-bot challenge rejected livestream-api.pump.fun for hours at a
// time; every one of these routes had no (or, for the list/stats pair, only a
// hand-rolled) last-known-good tier, so a sustained block turned into a 502 for
// every visitor even though the board itself had not changed.
//
// cache.js is mocked with a Map-backed fake that implements cacheWrapLastGood's
// real semantics (api/_lib/cache.js:608-627): serve a fresh hit, otherwise run
// the loader, mirror a success into both the live key and its `:lkg` sibling,
// and if the loader rejects fall back to the `:lkg` mirror if one exists, else
// rethrow. The handlers call cacheWrapLastGood directly, so the fake has to be
// the real thing's behavior, not a plain cacheGet/cacheSet stand-in.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { publicIp: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })) },
	clientIp: () => '203.0.113.1',
}));

const store = new Map();

async function fakeCacheWrapLastGood(key, _ttlSeconds, fn, opts = {}) {
	const { withMeta = false } = opts;
	const lkgKey = `${key}:lkg`;
	if (store.has(key)) {
		const value = store.get(key);
		return withMeta ? { value, stale: false } : value;
	}
	try {
		const value = await fn();
		store.set(key, value);
		store.set(lkgKey, value);
		return withMeta ? { value, stale: false } : value;
	} catch (err) {
		if (store.has(lkgKey)) {
			const value = store.get(lkgKey);
			return withMeta ? { value, stale: true } : value;
		}
		throw err;
	}
}

vi.mock('../api/_lib/cache.js', () => ({
	cacheWrapLastGood: vi.fn((key, ttlSeconds, fn, opts) => fakeCacheWrapLastGood(key, ttlSeconds, fn, opts)),
}));

const listBounties = vi.fn();
const getBounty = vi.fn();
const getSubmissions = vi.fn();
vi.mock('../api/_lib/pump-go.js', async () => {
	const actual = await vi.importActual('../api/_lib/pump-go.js');
	return { ...actual, listBounties, getBounty, getSubmissions };
});

const { PumpGoError } = await import('../api/_lib/pump-go.js');

function makeReqRes(url) {
	const req = { method: 'GET', url, headers: {} };
	const res = {
		statusCode: 200,
		headers: {},
		body: '',
		setHeader(k, v) {
			this.headers[k.toLowerCase()] = v;
		},
		getHeader(k) {
			return this.headers[k.toLowerCase()];
		},
		end(b) {
			this.body = b ?? '';
		},
	};
	return { req, res };
}

const upstream403 = () => new PumpGoError('pump.fun GO upstream 403', 502, 'pump_go_upstream');

beforeEach(() => {
	store.clear();
	listBounties.mockReset();
	getBounty.mockReset();
	getSubmissions.mockReset();
});

describe('GET /api/pump-bounties', () => {
	it('serves fresh data and populates both the live and last-known-good cache entries', async () => {
		const { default: handler } = await import('../api/pump-bounties.js');
		listBounties.mockResolvedValueOnce({ items: [{ taskId: 't1' }], nextCursor: null });

		const { req, res } = makeReqRes('/api/pump-bounties?limit=30');
		await handler(req, res);

		expect(res.statusCode).toBe(200);
		expect(JSON.parse(res.body).items).toEqual([{ taskId: 't1' }]);
		expect(res.getHeader('x-pump-stale')).toBeUndefined();
		expect(store.has('pumpgo:list:30:_:_')).toBe(true);
		expect(store.has('pumpgo:list:30:_:_:lkg')).toBe(true);
	});

	it('serves the last-known-good list with x-pump-stale instead of a 502', async () => {
		const { default: handler } = await import('../api/pump-bounties.js');
		store.set('pumpgo:list:30:_:_:lkg', { items: [{ taskId: 'old' }], nextCursor: null });
		listBounties.mockRejectedValueOnce(upstream403());

		const { req, res } = makeReqRes('/api/pump-bounties?limit=30');
		await handler(req, res);

		expect(res.statusCode).toBe(200);
		expect(res.getHeader('x-pump-stale')).toBe('1');
		expect(JSON.parse(res.body).items).toEqual([{ taskId: 'old' }]);
	});

	it('propagates the upstream error unchanged on a true miss (no live data, no last-known-good)', async () => {
		const { default: handler } = await import('../api/pump-bounties.js');
		listBounties.mockRejectedValueOnce(upstream403());

		const { req, res } = makeReqRes('/api/pump-bounties?limit=30');
		await handler(req, res);

		expect(res.statusCode).toBe(502);
		expect(res.getHeader('x-pump-stale')).toBeUndefined();
		const body = JSON.parse(res.body);
		expect(body.error).toBe('pump_go_upstream');
		expect(body.error_description).toBe('pump.fun GO upstream 403');
	});
});

describe('GET /api/pump-bounties/stats', () => {
	it('serves fresh totals and populates both cache entries', async () => {
		const { default: handler } = await import('../api/pump-bounties/stats.js');
		listBounties.mockResolvedValueOnce({
			items: [{ reward: { totalUsd: 10 }, counts: { submissions: 2 }, likeCount: 1 }],
			nextCursor: null,
		});

		const { req, res } = makeReqRes('/api/pump-bounties/stats');
		await handler(req, res);

		expect(res.statusCode).toBe(200);
		expect(JSON.parse(res.body).count).toBe(1);
		expect(store.has('pumpgo:stats:v1')).toBe(true);
		expect(store.has('pumpgo:stats:v1:lkg')).toBe(true);
	});

	it('serves the last-known-good totals with x-pump-stale instead of a 502', async () => {
		const { default: handler } = await import('../api/pump-bounties/stats.js');
		store.set('pumpgo:stats:v1:lkg', { count: 3, totalRewardUsd: 30, totalSubmissions: 5, totalLikes: 2, truncated: false, updatedAt: '2026-10-24T00:00:00.000Z' });
		listBounties.mockRejectedValueOnce(upstream403());

		const { req, res } = makeReqRes('/api/pump-bounties/stats');
		await handler(req, res);

		expect(res.statusCode).toBe(200);
		expect(res.getHeader('x-pump-stale')).toBe('1');
		expect(JSON.parse(res.body).count).toBe(3);
	});

	it('propagates the upstream error unchanged on a true miss, even if it fails mid-walk', async () => {
		const { default: handler } = await import('../api/pump-bounties/stats.js');
		listBounties
			.mockResolvedValueOnce({ items: [{ reward: { totalUsd: 1 }, counts: { submissions: 0 }, likeCount: 0 }], nextCursor: 'c2' })
			.mockRejectedValueOnce(upstream403());

		const { req, res } = makeReqRes('/api/pump-bounties/stats');
		await handler(req, res);

		expect(res.statusCode).toBe(502);
		expect(store.has('pumpgo:stats:v1')).toBe(false);
	});
});

describe('GET /api/pump-bounties/:id', () => {
	const id = 'b4a26396-75a7-4bce-a3b5-e3c99aaa73c1';

	it('serves the fresh bounty with its submissions', async () => {
		const { default: handler } = await import('../api/pump-bounties/[id].js');
		getBounty.mockResolvedValueOnce({ taskId: id, title: 'Fresh' });
		getSubmissions.mockResolvedValueOnce({ items: [{ id: 's1' }], nextCursor: null });

		const { req, res } = makeReqRes(`/api/pump-bounties/${id}`);
		await handler(req, res);

		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body.bounty.title).toBe('Fresh');
		expect(body.submissions).toEqual([{ id: 's1' }]);
		expect(res.getHeader('x-pump-stale')).toBeUndefined();
	});

	it('serves the last-known-good bounty with x-pump-stale, and still tries for fresh submissions', async () => {
		const { default: handler } = await import('../api/pump-bounties/[id].js');
		store.set(`pumpgo:task:${id}:lkg`, { taskId: id, title: 'Stale' });
		getBounty.mockRejectedValueOnce(upstream403());
		getSubmissions.mockResolvedValueOnce({ items: [{ id: 's1' }], nextCursor: null });

		const { req, res } = makeReqRes(`/api/pump-bounties/${id}`);
		await handler(req, res);

		expect(res.statusCode).toBe(200);
		expect(res.getHeader('x-pump-stale')).toBe('1');
		const body = JSON.parse(res.body);
		expect(body.bounty.title).toBe('Stale');
		expect(body.submissions).toEqual([{ id: 's1' }]);
		expect(getSubmissions).toHaveBeenCalledWith(id, { limit: 50 });
	});

	it('propagates the upstream error unchanged when nothing is cached', async () => {
		const { default: handler } = await import('../api/pump-bounties/[id].js');
		getBounty.mockRejectedValueOnce(upstream403());
		getSubmissions.mockResolvedValueOnce({ items: [], nextCursor: null });

		const { req, res } = makeReqRes(`/api/pump-bounties/${id}`);
		await handler(req, res);

		expect(res.statusCode).toBe(502);
		expect(res.getHeader('x-pump-stale')).toBeUndefined();
	});

	it('degrades submissions to an empty list on their own failure without touching the bounty', async () => {
		const { default: handler } = await import('../api/pump-bounties/[id].js');
		getBounty.mockResolvedValueOnce({ taskId: id, title: 'Fresh' });
		getSubmissions.mockRejectedValueOnce(new Error('submissions down'));

		const { req, res } = makeReqRes(`/api/pump-bounties/${id}`);
		await handler(req, res);

		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body.bounty.title).toBe('Fresh');
		expect(body.submissions).toEqual([]);
	});
});
