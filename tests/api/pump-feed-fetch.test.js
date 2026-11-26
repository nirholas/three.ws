// api/_lib/pump-feed-fetch.js: the shared pump.fun read layer behind
// /api/crypto/trending and /api/crypto/whales.
//
// What is pinned here is exactly what used to break in production: pump.fun sits
// behind Cloudflare, a burst of per-coin trade pulls earns HTTP 429 ("error code:
// 1015"), and both endpoints then reported "upstream unavailable" while the feed
// was healthy. So: the cache collapses repeat pulls, a 429 is retried once, a
// rate-limited pull falls back to the last-known-good rows and flags them stale,
// and a genuinely empty answer is NOT reported as an outage.
//
// fetch is stubbed; no network is touched. The mint fixture is $THREE.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const cache = new Map();
vi.mock('../../api/_lib/cache.js', () => ({
	cacheGet: async (k) => (cache.has(k) ? cache.get(k) : null),
	cacheSet: async (k, v) => { cache.set(k, v); },
}));

// pump.fun retired its HTTP trade feeds on 2026-11-25 (swap-api /v2 trades is
// 410, frontend /trades/all rejects every request), so trades come from the
// chain reader. It is stubbed here; its decoding is pinned by its own tests.
const chain = vi.hoisted(() => ({ rows: vi.fn() }));
vi.mock('../../api/_lib/pump-chain-trades.js', () => ({ fetchChainTradeRows: (...a) => chain.rows(...a) }));

const { pumpFetchJson, fetchPumpTrades, fetchPumpBoard } = await import('../../api/_lib/pump-feed-fetch.js');

const THREE = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

function jsonRes(body, status = 200, headers = {}) {
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: { get: (h) => headers[h.toLowerCase()] ?? null },
		json: async () => body,
	};
}

const tradeRow = { type: 'buy', amountSol: '9.5', userAddress: 'HKKp49zUBeaABFMpBWKCJPoNDLiR4AEEr8FJKuZPn6Nk', tx: 'sig1', timestamp: '2026-08-12T20:00:00.000Z' };
const coinRow = { mint: THREE, symbol: 'THREE', name: 'three.ws', usd_market_cap: 1234 };

beforeEach(() => {
	cache.clear();
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

// The module sleeps between retries; run timers as they are scheduled so the
// retry path completes without a real wall-clock wait.
async function withTimers(promise) {
	const settled = promise;
	await vi.runAllTimersAsync();
	return settled;
}

describe('pumpFetchJson: retry on a rate limit', () => {
	it('retries once on 429 and returns the recovered body', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(jsonRes(null, 429, { 'retry-after': '0.2' }))
			.mockResolvedValueOnce(jsonRes({ ok: 1 }));
		vi.stubGlobal('fetch', fetchMock);
		const out = await withTimers(pumpFetchJson('https://swap-api.pump.fun/x'));
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(out).toEqual({ ok: true, status: 200, body: { ok: 1 } });
	});

	it('gives up after the bounded retry and reports the failing status', async () => {
		const fetchMock = vi.fn().mockResolvedValue(jsonRes(null, 429, {}));
		vi.stubGlobal('fetch', fetchMock);
		const out = await withTimers(pumpFetchJson('https://swap-api.pump.fun/x'));
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(out.ok).toBe(false);
		expect(out.status).toBe(429);
	});

	it('does not retry a client error that will not recover', async () => {
		const fetchMock = vi.fn().mockResolvedValue(jsonRes(null, 404, {}));
		vi.stubGlobal('fetch', fetchMock);
		const out = await withTimers(pumpFetchJson('https://swap-api.pump.fun/x'));
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(out.ok).toBe(false);
	});

	it('never throws on a network failure', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('econnreset')));
		const out = await withTimers(pumpFetchJson('https://swap-api.pump.fun/x'));
		expect(out).toEqual({ ok: false, status: 0, body: null });
	});
});

describe('fetchPumpTrades: chain source, cache, failure contract', () => {
	beforeEach(() => chain.rows.mockReset());

	it('reads trades from the chain, never pump.fun\'s retired HTTP trade routes', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		chain.rows.mockResolvedValue([tradeRow]);
		const out = await withTimers(fetchPumpTrades(THREE, { limit: 100 }));
		expect(out).toEqual({ rows: [tradeRow], stale: false });
		expect(chain.rows).toHaveBeenCalledWith(THREE, { limit: 50 });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('serves a second pull for the same mint from cache without a second read', async () => {
		chain.rows.mockResolvedValue([tradeRow]);
		await withTimers(fetchPumpTrades(THREE, { limit: 100 }));
		await withTimers(fetchPumpTrades(THREE, { limit: 100 }));
		expect(chain.rows).toHaveBeenCalledTimes(1);
	});

	it('a coin with no trades is data, not an outage', async () => {
		chain.rows.mockResolvedValue([]);
		const out = await withTimers(fetchPumpTrades(THREE, { limit: 100 }));
		expect(out).toEqual({ rows: [], stale: false });
	});

	it('falls back to last-known-good rows when the read fails, flagged stale', async () => {
		chain.rows.mockResolvedValue([tradeRow]);
		await withTimers(fetchPumpTrades(THREE, { limit: 100 }));
		// Live TTL lapses, last-known-good survives.
		cache.delete(`pump:feed:trades:${THREE}:50`);
		chain.rows.mockResolvedValue(null);
		const out = await withTimers(fetchPumpTrades(THREE, { limit: 100 }));
		expect(out).toEqual({ rows: [tradeRow], stale: true });
	});

	it('returns null when the read fails and nothing was ever cached', async () => {
		chain.rows.mockResolvedValue(null);
		const out = await withTimers(fetchPumpTrades(THREE, { limit: 100 }));
		expect(out).toBeNull();
	});
});

describe('fetchPumpBoard: coin filtering + cache', () => {
	it('keeps only rows carrying a plausible mint', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes([coinRow, { mint: 'short' }, null, { symbol: 'X' }])));
		const out = await withTimers(fetchPumpBoard({ limit: 20 }));
		expect(out.rows).toEqual([coinRow]);
		expect(out.stale).toBe(false);
	});

	it('reuses the cached board for the same limit', async () => {
		const fetchMock = vi.fn().mockResolvedValue(jsonRes({ coins: [coinRow] }));
		vi.stubGlobal('fetch', fetchMock);
		await withTimers(fetchPumpBoard({ limit: 20 }));
		await withTimers(fetchPumpBoard({ limit: 20 }));
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('null when the board is unreachable with no last-known-good copy', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
		expect(await withTimers(fetchPumpBoard({ limit: 20 }))).toBeNull();
	});
});
