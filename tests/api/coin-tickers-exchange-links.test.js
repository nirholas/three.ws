// /api/coin/tickers fallback rows must link to an exchange id the /exchange/:id
// page can open.
//
// Measured 2026-11-25 in production: /api/coin/exchange answered 502 about 60
// times in three hours, most for ids CoinGecko does not have at all. The page
// is addressed by CoinGecko exchange id, but when the Markets table fell back
// to CoinPaprika (or DexScreener) each row carried THAT source's venue id, so
// a visitor clicking a venue opened /exchange/<paprika-id>: CoinGecko 404'd in
// both its spot and derivatives namespaces, and a throttled second lookup
// turned the dead link into a 502. Fallback rows are now re-keyed against
// CoinGecko's own exchange catalog, and a venue with no match renders unlinked.
//
// Venue names here are synthetic; the shapes match the live catalog.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../api/_lib/zauth.js', () => ({ instrument: () => {}, drain: async () => {} }));
vi.mock('../../api/_lib/sentry.js', () => ({ captureException: () => {} }));
vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: { marketDataIp: async () => ({ success: true }) },
	clientIp: () => '203.0.113.1',
}));

const CATALOG = [
	{ id: 'fixture-moe-chain', name: 'Fixture Moe' },
	{ id: 'fixturex_spot', name: 'FixtureX' },
	{ id: 'fixtureswap_v3', name: 'FixtureSwap V3 (Chain A)' },
	{ id: 'fixtureswap_v3_b', name: 'FixtureSwap V3 (Chain B)' },
	{ id: 'samevenue', name: 'Same Venue' },
	{ id: 'oldbourse', name: 'Old Bourse Exchange' },
];

let catalogAvailable = true;
const geckoFetch = vi.fn(async (path) => {
	if (path === '/exchanges/list' && catalogAvailable) return CATALOG;
	const err = new Error(`CoinGecko 429 for ${path}`);
	err.status = 429;
	throw err;
});
vi.mock('../../api/_lib/coingecko.js', () => ({
	geckoFetch: (...args) => geckoFetch(...args),
	isPlausibleCoinId: (id) => /^[a-z0-9][a-z0-9-]*$/.test(id),
	htmlToText: (s) => String(s || ''),
}));

const row = (id, name) => ({ exchange: { id, name, logo: null }, pair: 'FXT/USDT', price_usd: 1, volume_usd: 1 });
const PAPRIKA_ROWS = [
	row('fixturemoe', 'Fixture Moe'), // same venue, different id spelling
	row('fixturex-spot', 'FixtureX (Spot)'), // CoinGecko names it without the qualifier
	row('fixtureswap-v3', 'FixtureSwap V3 (Chain A)'), // exact name
	row('samevenue', 'Same Venue'), // ids already agree
	row('oldbourse', 'Old Bourse'), // id agrees, trailing "Exchange" differs
	row('unknownvenue', 'Unknown Venue'), // not in the catalog
	row('fixtureswap', 'FixtureSwap V3'), // matches two catalog venues: ambiguous
];

const fetchFallbackTickers = vi.fn();
vi.mock('../../api/_lib/coin-fallbacks.js', async (importActual) => {
	const actual = await importActual();
	return {
		fetchFallbackCoinDetail: async () => null,
		fetchFallbackTickers: (...args) => fetchFallbackTickers(...args),
		fetchDexTickers: actual.fetchDexTickers,
		isDexLookupAddress: actual.isDexLookupAddress,
		DEX_TICKER_MAX_ADDRESSES: actual.DEX_TICKER_MAX_ADDRESSES,
	};
});

const tickers = (await import('../../api/coin/tickers.js')).default;
const exchangeIds = await import('../../api/_lib/gecko-exchange-ids.js').catch(() => null);

function makeRes() {
	return {
		statusCode: 200,
		_h: {},
		setHeader(k, v) { this._h[k.toLowerCase()] = v; },
		getHeader(k) { return this._h[k.toLowerCase()]; },
		end(body) { this._body = body; },
	};
}
async function call(query) {
	const res = makeRes();
	await tickers({ url: `/api/coin/tickers?${query}`, method: 'GET', headers: {} }, res);
	return { res, body: JSON.parse(res._body) };
}

beforeEach(async () => {
	catalogAvailable = true;
	fetchFallbackTickers.mockReset();
	fetchFallbackTickers.mockImplementation(async () => PAPRIKA_ROWS.map((r) => ({ ...r, exchange: { ...r.exchange } })));
	await exchangeIds?.resetGeckoExchangeCatalog?.();
});

describe('fallback Markets rows link to CoinGecko exchange ids', () => {
	it('re-keys each venue to the CoinGecko id, and leaves an unmatched or ambiguous venue unlinked', async () => {
		const { res, body } = await call('id=fixture-coin');
		expect(res.statusCode).toBe(200);
		expect(body.source).toBe('coinpaprika');
		expect(body.tickers.map((t) => t.exchange.id)).toEqual([
			'fixture-moe-chain',
			'fixturex_spot',
			'fixtureswap_v3',
			'samevenue',
			'oldbourse',
			null,
			null,
		]);
		// Names stay as the answering source spelled them.
		expect(body.tickers[1].exchange.name).toBe('FixtureX (Spot)');
	});

	it('keeps the source ids when the catalog cannot be read at all', async () => {
		catalogAvailable = false;
		const { body } = await call('id=fixture-coin-2');
		expect(body.tickers.map((t) => t.exchange.id)).toEqual(PAPRIKA_ROWS.map((r) => r.exchange.id));
	});
});
