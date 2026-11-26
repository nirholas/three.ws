// GET /api/pump/coin-trades feeds the homepage live token card, the trade list
// on /launches/<mint>, community pages and the in-world chart tape. It proxied
// swap-api /v2/coins/<mint>/trades, which pump.fun retired on 2026-11-25 (410
// "deprecated"), so every poll answered { trades: [], stale: true } and every
// tape went quiet. It now reads the shared trade feed decoded from Solana.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/_lib/cache.js', () => ({ cacheGet: async () => null, cacheSet: async () => {} }));
vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async () => []),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
	isStoragePressured: () => false,
}));

const fetchPumpTrades = vi.fn();
vi.mock('../api/_lib/pump-feed-fetch.js', async (orig) => ({ ...(await orig()), fetchPumpTrades }));

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

const { handleCoinTrades } = await import('../api/pump/[action].js');

const THREE = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const TS = 1_790_000_000;
const row = (signature, type, amountSol, amountUsd, priceUsd) => ({
	signature, tx: signature, type, txType: type, amountSol, amountUsd, priceUsd,
	tokenAmount: '1000000', userAddress: 'THREEsynthetic1111', user: 'THREEsynthetic1111', timestamp: TS,
});

const req = (q) => ({ method: 'GET', headers: { host: 'localhost' }, url: `/api/pump/coin-trades?${q}` });
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

beforeEach(() => fetchPumpTrades.mockReset());

describe('GET /api/pump/coin-trades', () => {
	it('serves trades from the shared Solana trade feed in the coin-trades shape', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('gone', { status: 410 })));
		fetchPumpTrades.mockResolvedValue({ rows: [row('sigA', 'buy', 1.5, 225, 0.0004), row('sigB', 'sell', 0.5, 75, 0.0004), row('sigC', 'buy', 2, 300, 0.0004)], stale: false });
		const res = mockRes();
		await handleCoinTrades(req(`mint=${THREE}&limit=2`), res);
		expect(res.statusCode).toBe(200);
		expect(fetchPumpTrades).toHaveBeenCalledWith(THREE, { limit: 50 });
		expect(globalThis.fetch).not.toHaveBeenCalled();
		expect(res.json).toEqual({
			mint: THREE,
			trades: [
				{ tx: 'sigA', timestamp: new Date(TS * 1000).toISOString(), user: 'THREEsynthetic1111', is_buy: true, sol_amount: 1.5, quote_symbol: 'SOL', quote_amount: 1.5, usd_amount: 225, price_usd: 0.0004 },
				{ tx: 'sigB', timestamp: new Date(TS * 1000).toISOString(), user: 'THREEsynthetic1111', is_buy: false, sol_amount: 0.5, quote_symbol: 'SOL', quote_amount: 0.5, usd_amount: 75, price_usd: 0.0004 },
			],
		});
		vi.unstubAllGlobals();
	});

	it('passes a last-known-good read through flagged stale', async () => {
		fetchPumpTrades.mockResolvedValue({ rows: [row('sigA', 'buy', 1, 150, null)], stale: true });
		const res = mockRes();
		await handleCoinTrades(req(`mint=${THREE}`), res);
		expect(res.json.stale).toBe(true);
		expect(res.json.trades).toHaveLength(1);
		expect(res._headers['cache-control']).toBe('no-store');
	});

	it('degrades to an empty stale 200 when the read fails', async () => {
		fetchPumpTrades.mockResolvedValue(null);
		const res = mockRes();
		await handleCoinTrades(req(`mint=${THREE}`), res);
		expect(res.statusCode).toBe(200);
		expect(res.json).toEqual({ mint: THREE, trades: [], stale: true, reason: 'trades_unavailable' });
	});
});
