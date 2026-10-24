// handleCoin (api/pump/[action].js) -- the GET /api/pump/coin degrade chain.
//
// Reproduces a real production outage (measured 2026-10-24): pump.fun's
// frontend-api-v3 answers every request from our environment with a
// Cloudflare 403, and the 24h last-known-good cache for $THREE's own mint has
// already been exhausted. Before this fix, that triple-miss (no in-memory
// cache, no LKG, upstream down) was a bare 502 with no partial data, even
// though two real, first-party sources (the on-chain bonding curve, and the
// platform's own pump_agent_mints launch registry) could still answer.
//
// Mocking pattern mirrors tests/pump-bonding.test.js (Map-backed cache.js,
// mocked getCurveView) plus tests/pump-live-stream.test.js (the minimal mock
// set required to import api/pump/[action].js, a large dispatcher file with
// many heavy module-level imports that are irrelevant to this handler).
//
// handleCoin keeps its own in-process `COIN_CACHE` Map (module-scoped, never
// reset by this file's cache.js mock). Each test below that does not care
// about priming it uses its own synthetic mint so a prior test's cache entry
// can never leak into it; the one test that deliberately exercises the
// in-memory-stale-but-present path uses fake timers to age its own entry past
// the 30s freshness window within a single test, then restores real timers.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const cache = new Map();
vi.mock('../api/_lib/cache.js', () => ({
	cacheGet: async (k) => (cache.has(k) ? cache.get(k) : null),
	cacheSet: async (k, v) => { cache.set(k, v); },
}));

const sql = vi.fn(async () => []);
vi.mock('../api/_lib/db.js', () => ({
	sql,
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
	isStoragePressured: () => false,
}));

// The on-chain fallback (getCurveView) is the proven reader already live
// behind /api/pump/curve (order 423); mocked here so this stays a unit test of
// handleCoin's branching, not an RPC integration test.
vi.mock('../api/_lib/pump-curve-view.js', () => ({
	getCurveView: vi.fn(),
}));

const pumpFetchJson = vi.fn();
vi.mock('../api/_lib/pump-feed-fetch.js', () => ({ pumpFetchJson }));

vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { mcpIp: vi.fn(async () => ({ success: true })) },
	clientIp: vi.fn(() => '127.0.0.1'),
}));

vi.mock('../api/_lib/env.js', () => ({
	env: { APP_ORIGIN: 'http://test', ISSUER: 'http://test', MCP_RESOURCE: 'http://test' },
}));

// Heavy Solana SDK / unrelated subsystem imports not needed for this handler.
vi.mock('../api/_lib/pump.js', () => ({}));
vi.mock('../api/_lib/auth.js', () => ({
	getSessionUser: vi.fn(async () => null),
	authenticateBearer: vi.fn(async () => null),
	extractBearer: vi.fn(() => null),
}));
vi.mock('../api/_lib/solana-wallet.js', () => ({}));
vi.mock('../api/_lib/agent-pumpfun.js', () => ({ solanaConnection: vi.fn() }));
vi.mock('../api/_lib/skill-runtime.js', () => ({ makeRuntime: vi.fn() }));
vi.mock('../api/_lib/agent-spend-policy.js', () => ({}));
vi.mock('../api/payments/_config.js', () => ({
	SOLANA_USDC_MINT: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
	SOLANA_USDC_MINT_DEVNET: 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr',
	toUsdcAtomics: vi.fn((v) => BigInt(Math.round(v * 1e6))),
}));

const { handleCoin } = await import('../api/pump/[action].js');
const { getCurveView } = await import('../api/_lib/pump-curve-view.js');

// $THREE's own mint: the platform's own coin, not a third-party placeholder.
const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

// Clearly-synthetic per-test mints (CLAUDE.md's sanctioned placeholder style):
// handleCoin keyes its in-process cache by mint, so giving each independent
// test its own key means no test can ever observe another test's cache entry.
function synthMint(tag) {
	return (`THREEtest${tag}` + '9'.repeat(44)).slice(0, 44);
}

function mockReq(mint) {
	return {
		method: 'GET',
		headers: { host: 'localhost' },
		url: `/api/pump/coin?mint=${encodeURIComponent(mint)}`,
	};
}

function mockRes() {
	return {
		statusCode: 200,
		_headers: {},
		_body: '',
		setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
		getHeader(k) { return this._headers[k.toLowerCase()]; },
		end(b) { this._body = b || ''; },
		get headersSent() { return false; },
		get writableEnded() { return false; },
		get json() { try { return JSON.parse(this._body); } catch { return null; } },
	};
}

function pumpfunCoinBody(mint, overrides = {}) {
	return {
		mint,
		name: 'three.ws',
		symbol: 'THREE',
		image_uri: 'https://ipfs.io/ipfs/bafy-three',
		usd_market_cap: 296832.56,
		complete: true,
		total_supply: 1_000_000_000_000_000,
		...overrides,
	};
}

function onchainCurveBody(mint) {
	return {
		httpStatus: 200,
		body: {
			mint,
			network: 'mainnet',
			curve: {
				virtualTokenReserves: '0',
				virtualSolReserves: '0',
				realTokenReserves: '0',
				realSolReserves: '0',
				tokenTotalSupply: '1000000000000000',
				complete: true,
				creator: '9wgvwps9qK5jNniC5RJdrYCfaV3CLKTnxYVqBjXwegEV',
			},
			graduated: true,
			graduation: { isGraduated: true, progressBps: 10_000 },
			graduatedPrice: { priceUsd: 0.00029683255767706676, source: 'jupiter', marketCapUsd: 296832.55767706677 },
		},
	};
}

beforeEach(() => {
	cache.clear();
	sql.mockReset().mockResolvedValue([]);
	pumpFetchJson.mockReset();
	getCurveView.mockReset().mockResolvedValue({
		httpStatus: 404,
		body: { error: 'no_curve', error_description: 'no bonding curve found for that mint' },
	});
});

describe('handleCoin -- live fetch (regression guard)', () => {
	it('live fetch succeeds: 200 with the unmodified pump.fun body', async () => {
		pumpFetchJson.mockResolvedValue({ ok: true, status: 200, body: pumpfunCoinBody(THREE_MINT) });
		const req = mockReq(THREE_MINT);
		const res = mockRes();

		await handleCoin(req, res);

		expect(res.statusCode).toBe(200);
		expect(res.json.symbol).toBe('THREE');
		expect(res.json.usd_market_cap).toBe(296832.56);
		expect(res._headers['x-pump-stale']).toBeUndefined();
		expect(res._headers['x-pump-degraded']).toBeUndefined();
	});
});

describe('handleCoin -- in-memory cache fallback (regression guard)', () => {
	it('live fetch fails, an aged in-memory entry exists: stale 200 with x-pump-stale', async () => {
		const mint = synthMint('A');
		vi.useFakeTimers();
		try {
			// Prime the cache the way a prior successful handleCoin call would.
			pumpFetchJson.mockResolvedValueOnce({ ok: true, status: 200, body: pumpfunCoinBody(mint) });
			await handleCoin(mockReq(mint), mockRes());

			// Age the entry past COIN_TTL_MS (30s) so the next call's freshness
			// check misses and a live fetch is actually attempted (and fails).
			vi.advanceTimersByTime(31_000);

			pumpFetchJson.mockResolvedValueOnce({ ok: false, status: 403 });
			const req = mockReq(mint);
			const res = mockRes();
			await handleCoin(req, res);

			expect(res.statusCode).toBe(200);
			expect(res._headers['x-pump-stale']).toBe('1');
			expect(res._headers['x-pump-degraded']).toBeUndefined();
			expect(res.json.symbol).toBe('THREE');
			expect(res.json.stale).toBe(true);
			expect(getCurveView).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('handleCoin -- on-chain degrade (the new tier)', () => {
	it('upstream down, no in-memory cache, no LKG, curve read works, no DB row: 200 with numeric fields and an explicit unavailable identity', async () => {
		const mint = synthMint('B');
		pumpFetchJson.mockResolvedValue({ ok: false, status: 403 });
		getCurveView.mockResolvedValue(onchainCurveBody(mint));
		sql.mockResolvedValue([]); // no pump_agent_mints row

		const req = mockReq(mint);
		const res = mockRes();
		await handleCoin(req, res);

		expect(res.statusCode).toBe(200);
		expect(res._headers['x-pump-degraded']).toBe('onchain');
		expect(res._headers['x-pump-stale']).toBeUndefined();
		expect(res.json.mint).toBe(mint);
		expect(res.json.usd_market_cap).toBeCloseTo(296832.55767706677, 3);
		expect(res.json.complete).toBe(true);
		expect(res.json.name).toBeNull();
		expect(res.json.symbol).toBeNull();
		expect(res.json.image).toBeNull();
		expect(res.json.metadataSource).toBe('onchain');
		expect(res.json.stale).toBe(true);
	});

	it('same triple-miss but a pump_agent_mints row exists: 200 with identity fields from the platform registry', async () => {
		const mint = synthMint('C');
		pumpFetchJson.mockResolvedValue({ ok: false, status: 403 });
		getCurveView.mockResolvedValue(onchainCurveBody(mint));
		sql.mockResolvedValue([
			{ name: 'three.ws', symbol: 'THREE', agent_authority: '9wgvwps9qK5jNniC5RJdrYCfaV3CLKTnxYVqBjXwegEV' },
		]);

		const req = mockReq(mint);
		const res = mockRes();
		await handleCoin(req, res);

		expect(res.statusCode).toBe(200);
		expect(res._headers['x-pump-degraded']).toBe('onchain');
		expect(res.json.name).toBe('three.ws');
		expect(res.json.symbol).toBe('THREE');
		expect(res.json.creator).toBe('9wgvwps9qK5jNniC5RJdrYCfaV3CLKTnxYVqBjXwegEV');
		expect(res.json.metadataSource).toBe('platform');
		expect(res.json.usd_market_cap).toBeCloseTo(296832.55767706677, 3);
	});
});

describe('handleCoin -- true triple-miss (regression guard on the honest-failure path)', () => {
	it('upstream down, no caches, on-chain fallback also unavailable, no DB row: still a 502 naming pump.fun', async () => {
		const mint = synthMint('D');
		pumpFetchJson.mockResolvedValue({ ok: false, status: 403 });
		getCurveView.mockResolvedValue({
			httpStatus: 404,
			body: { error: 'no_curve', error_description: 'no bonding curve found for that mint' },
		});
		sql.mockResolvedValue([]);

		const req = mockReq(mint);
		const res = mockRes();
		await handleCoin(req, res);

		expect(res.statusCode).toBe(502);
		expect(res.json.error).toBe('upstream_failed');
		expect(res.json.error_description).toContain('pump.fun');
		expect(res._headers['x-pump-degraded']).toBeUndefined();
		expect(res._headers['x-pump-stale']).toBeUndefined();
	});

	it('also 502s honestly when the on-chain reader itself throws', async () => {
		const mint = synthMint('E');
		pumpFetchJson.mockResolvedValue({ ok: false, status: 403 });
		getCurveView.mockRejectedValue(new Error('all RPC lanes failed'));
		sql.mockResolvedValue([]);

		const req = mockReq(mint);
		const res = mockRes();
		await handleCoin(req, res);

		expect(res.statusCode).toBe(502);
		expect(res.json.error_description).toContain('pump.fun');
	});
});
