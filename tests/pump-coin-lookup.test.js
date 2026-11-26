// pump.fun retired its single-coin route: on 2026-11-25 GET
// frontend-api-v3.pump.fun/coins/<mint> answered 404 "Cannot GET /coins/<mint>"
// for every mint, $THREE included, so every three.ws feature that looked a coin
// up by mint (the /play coin card, holder-gate pricing, achievements, the intel
// heatmap, community world gates, copy-trade context, the pump snapshot tools)
// got "no such coin". The full coin record is still served by the search route,
// keyed by the mint. fetchPumpCoin reads it there and accepts only an exact mint
// match, because search also returns fuzzy hits for other coins.

import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../api/_lib/cache.js', () => ({ cacheGet: async () => null, cacheSet: async () => {} }));

const { fetchPumpCoin, pumpCoinSearchUrl, pickPumpCoin } = await import('../api/_lib/pump-feed-fetch.js');

const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const OTHER = 'THREEsynthetic11111111111111111111111111pump';

function respond(status, body) {
	return new Response(body == null ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('fetchPumpCoin', () => {
	it('reads the coin from the search route, not the retired /coins/<mint>', async () => {
		const seen = [];
		vi.stubGlobal('fetch', vi.fn(async (url) => {
			seen.push(String(url));
			return respond(200, [{ mint: THREE_MINT, name: 'three.ws', symbol: 'three', usd_market_cap: 423737.4, complete: true }]);
		}));

		const r = await fetchPumpCoin(THREE_MINT);

		expect(r).toMatchObject({ ok: true, status: 200 });
		expect(r.body).toMatchObject({ mint: THREE_MINT, name: 'three.ws', complete: true });
		const u = new URL(seen[0]);
		expect(u.pathname).toBe('/coins/search-unrestricted');
		expect(u.searchParams.get('searchTerm')).toBe(THREE_MINT);
	});

	it('ignores fuzzy matches for other coins and reports a miss as 404', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => respond(200, [{ mint: OTHER, name: 'something else' }])));
		expect(await fetchPumpCoin(THREE_MINT)).toEqual({ ok: false, status: 404, body: null });
	});

	it('passes an upstream failure through unchanged so callers can tell it from a miss', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => respond(403, { error: 'access_denied' })));
		expect(await fetchPumpCoin(THREE_MINT)).toEqual({ ok: false, status: 403, body: null });
	});
});

describe('pumpCoinSearchUrl / pickPumpCoin', () => {
	it('builds the search URL and picks the exact match for callers with their own fetch', () => {
		const u = new URL(pumpCoinSearchUrl(THREE_MINT));
		expect(u.pathname).toBe('/coins/search-unrestricted');
		expect(u.searchParams.get('searchTerm')).toBe(THREE_MINT);
		expect(pickPumpCoin([{ mint: OTHER }, { mint: THREE_MINT, name: 'three.ws' }], THREE_MINT)).toEqual({ mint: THREE_MINT, name: 'three.ws' });
		expect(pickPumpCoin({ error: 'x' }, THREE_MINT)).toBeNull();
		expect(pickPumpCoin(null, THREE_MINT)).toBeNull();
	});
});

// The same day pump.fun stopped honouring `searchTerm` on GET /coins: every
// query returned the market-cap board, so the command palette's pump.fun
// fallback and /api/pump/search answered "the top coins" for any text typed.
// The search route still filters, but it spans several chains.
const SOL = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const SEARCH_ROWS = [
	{ mint: THREE_MINT, name: 'three.ws', symbol: 'three', chain_id: SOL, usd_market_cap: 423737.4, image_uri: 'https://ipfs.io/ipfs/bafy-three' },
	{ mint: '0xsynthetic0000000000000000000000000000000000', name: 'three', symbol: 'three', chain_id: 'othernet:1', usd_market_cap: 8000 },
	{ mint: OTHER, name: 'three nsfw', symbol: 'TNSFW', chain_id: SOL, nsfw: true, usd_market_cap: 900 },
];

describe('solanaSearchRows', () => {
	it('keeps Solana, non-NSFW rows in pump.fun order', async () => {
		const { solanaSearchRows } = await import('../api/_lib/pump-coin-search.js');
		expect(solanaSearchRows(SEARCH_ROWS).map((c) => c.mint)).toEqual([THREE_MINT]);
		expect(solanaSearchRows(SEARCH_ROWS, { includeNsfw: true }).map((c) => c.mint)).toEqual([THREE_MINT, OTHER]);
		expect(solanaSearchRows([{ mint: THREE_MINT }]).map((c) => c.mint)).toEqual([THREE_MINT]);
		expect(solanaSearchRows({ error: 'x' })).toBeNull();
	});
});

describe('searchPumpFun (command palette fallback)', () => {
	it('queries the search route and returns only Solana matches', async () => {
		const seen = [];
		vi.stubGlobal('fetch', vi.fn(async (url) => {
			seen.push(String(url));
			return respond(200, SEARCH_ROWS);
		}));
		const { searchPumpFun } = await import('../api/_lib/pump-search.js');

		const out = await searchPumpFun('three', 10);

		const u = new URL(seen[0]);
		expect(u.pathname).toBe('/coins/search-unrestricted');
		expect(u.searchParams.get('searchTerm')).toBe('three');
		expect(u.searchParams.get('limit')).toBe('10');
		expect(out).toEqual([
			{ mint: THREE_MINT, symbol: 'three', name: 'three.ws', logo: expect.any(String), price_usd: null, usd_market_cap: 423737.4, rank: 1 },
		]);
	});
});
