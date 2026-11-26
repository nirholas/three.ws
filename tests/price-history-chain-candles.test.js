// The price chart's last live rung was pump.fun's candle API, the one source
// that charts a coin still on the bonding curve before GeckoTerminal indexes
// it. pump.fun retired every candle route on 2026-11-25 (swap-api v1 404, v2
// 410), so young coins answered "no market" and their charts went blank. The
// rung now builds candles from the coin's own Solana trades.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../api/_lib/birdeye.js', () => ({ birdeyeConfigured: () => false, fetchBirdeyeOhlcv: vi.fn() }));
vi.mock('../api/_lib/zauth.js', () => ({ instrument: () => {}, drain: async () => {} }));
vi.mock('../api/_lib/sentry.js', () => ({ captureException: () => {} }));
const chain = { pages: [], calls: [] };
vi.mock('../api/_lib/pump-chain-trades.js', () => ({
	fetchChainTradePage: vi.fn(async (mint, opts) => {
		chain.calls.push({ mint, ...opts });
		return chain.pages.length ? chain.pages.shift() : { rows: [], cursor: null, hasMore: false };
	}),
}));

const { default: handler, candlesFromTrades } = await import('../api/pump/price-history.js');

const MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const res = () => ({
	statusCode: 200, _h: {}, _body: null,
	setHeader(k, v) { this._h[k.toLowerCase()] = v; }, getHeader(k) { return this._h[k.toLowerCase()]; },
	end(b) { this._body = b; },
});
const jsonResponse = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
	chain.pages = [];
	chain.calls = [];
	// GeckoTerminal has no pool for the coin yet; pump.fun candles are gone.
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
		const u = String(url);
		if (u.includes('/pools?')) return jsonResponse(404, {});
		if (u.includes('api.dexscreener.com')) return jsonResponse(200, { pairs: [] });
		return jsonResponse(404, { message: 'Cannot GET' });
	});
});
afterEach(() => vi.restoreAllMocks());

describe('candlesFromTrades', () => {
	it('buckets trade prices into epoch-aligned OHLCV, oldest first', () => {
		const rows = [
			{ timestamp: 1_000_250, priceUsd: 3, amountUsd: 30 },
			{ timestamp: 1_000_200, priceUsd: 1, amountUsd: 10 },
			{ timestamp: 1_000_100, priceUsd: 2, amountUsd: 20 },
			{ timestamp: 999_990, priceUsd: 5, amountUsd: null },
			{ timestamp: 1_000_150, priceUsd: null, amountUsd: 7 },
		];
		// 999_990 and 1_000_100 share the 999_900 bucket; 1_000_200 and 1_000_250
		// share 1_000_200. A row with no USD price is skipped; no USD amount adds 0.
		expect(candlesFromTrades(rows, 300)).toEqual([
			{ t: 999_900, o: 5, h: 5, l: 2, c: 2, v: 20 },
			{ t: 1_000_200, o: 1, h: 3, l: 1, c: 3, v: 40 },
		]);
	});
});

describe('on-chain candle rung', () => {
	it('charts a curve coin GeckoTerminal has not indexed from its Solana trades', async () => {
		const now = Math.floor(Date.now() / 1000);
		const from = now - 3600;
		chain.pages = [
			{ rows: [{ timestamp: now - 100, priceUsd: 0.0000031, amountUsd: 12 }, { timestamp: now - 700, priceUsd: 0.0000028, amountUsd: 5 }], cursor: 'sigB', hasMore: true },
			{ rows: [{ timestamp: from - 900, priceUsd: 0.0000020, amountUsd: 3 }], cursor: 'sigC', hasMore: true },
		];
		const r = res();
		await handler({ url: `/api/pump/price-history?mint=${MINT}&interval=5m&from=${from}&to=${now}`, method: 'GET', headers: {} }, r);
		expect(r.statusCode).toBe(200);
		const body = JSON.parse(r._body);
		expect(body.source).toBe('onchain');
		expect(body.data.at(-1).c).toBeCloseTo(0.0000031, 12);
		expect(body.data.every((c) => c.t >= from - 300)).toBe(true);
		// Walked back with the cursor, and stopped once a page reached past `from`.
		expect(chain.calls.map((c) => c.before ?? null)).toEqual([null, 'sigB']);
	});

	it('is the honest no_market when the coin has no curve or pool trades', async () => {
		const now = Math.floor(Date.now() / 1000);
		const r = res();
		await handler({ url: `/api/pump/price-history?mint=${MINT.slice(0, 40)}2222&interval=5m&from=${now - 3600}&to=${now}`, method: 'GET', headers: {} }, r);
		expect(r.statusCode).toBe(404);
		expect(JSON.parse(r._body).error).toBe('no_market');
	});
});
