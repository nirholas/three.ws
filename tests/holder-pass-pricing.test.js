// Unit tests for the coin-pricing fix behind the /play holder gate.
//
// Regression target: a wallet holding $8+ of a coin was gated at $0 because the
// balance read discarded the Jupiter price whenever Helius reported a 0
// (`helius ?? jup` → `0 ?? jup` → 0). pickTokenPrice encodes the corrected
// precedence; solanaMintUsdPrice is the gate's authoritative re-price path
// (Jupiter → pump.fun bonding curve) for coins the generic read leaves at $0.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { pickTokenPrice, solanaMintUsdPrice } from '../api/_lib/balances.js';

describe('pickTokenPrice', () => {
	it('uses the Jupiter price when Helius reports 0 (the gate-at-$0 regression)', () => {
		expect(pickTokenPrice(0, 0.0003946784630814265)).toBe(0.0003946784630814265);
	});

	it('prefers a positive Helius price over Jupiter', () => {
		expect(pickTokenPrice(72.32003, 72.0)).toBe(72.32003);
	});

	it('falls back to Jupiter when Helius is null/undefined', () => {
		expect(pickTokenPrice(null, 0.5)).toBe(0.5);
		expect(pickTokenPrice(undefined, 0.5)).toBe(0.5);
	});

	it('treats a non-numeric or negative Helius price as missing', () => {
		expect(pickTokenPrice(NaN, 0.7)).toBe(0.7);
		expect(pickTokenPrice(-5, 0.7)).toBe(0.7);
	});

	it('returns 0 only when neither source has a price', () => {
		expect(pickTokenPrice(0, 0)).toBe(0);
		expect(pickTokenPrice(null, null)).toBe(0);
	});
});

describe('solanaMintUsdPrice', () => {
	const MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
	// pump.fun as it answers since 2026-11-25: GET /coins/<mint> is gone (404) and
	// the coin record comes from the search route keyed by the mint.
	const pumpRoute = (u, coin) => {
		const url = new URL(u);
		if (url.pathname === '/coins/search-unrestricted') {
			return ok(coin ? [{ mint: url.searchParams.get('searchTerm'), ...coin }] : []);
		}
		return { ok: false, status: 404, json: async () => ({ message: `Cannot GET ${url.pathname}` }), text: async () => '' };
	};

	it('returns the Jupiter price and never touches pump.fun when Jupiter prices it', async () => {
		const fetchMock = vi.fn(async (url) => {
			if (String(url).includes('lite-api.jup.ag')) return ok({ [MINT]: { usdPrice: 0.0034 } });
			throw new Error('pump.fun should not be called when Jupiter has a price');
		});
		vi.stubGlobal('fetch', fetchMock);
		expect(await solanaMintUsdPrice(MINT)).toBe(0.0034);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('falls back to the pump.fun bonding curve when Jupiter has no price', async () => {
		const fetchMock = vi.fn(async (url) => {
			const u = String(url);
			if (u.includes('lite-api.jup.ag')) return ok({}); // Jupiter can't route it
			if (u.includes('pump.fun/coins')) {
				return pumpRoute(u, { usd_market_cap: 11185.5, total_supply_str: '1000000000000000', base_decimals: 6 });
			}
			throw new Error('unexpected url ' + u);
		});
		vi.stubGlobal('fetch', fetchMock);
		// 11185.5 / (1e15 / 1e6) = 11185.5 / 1e9 = 0.0000111855
		expect(await solanaMintUsdPrice(MINT)).toBeCloseTo(0.0000111855, 12);
	});

	it('returns 0 when neither Jupiter nor pump.fun can price the mint', async () => {
		const fetchMock = vi.fn(async (url) => {
			const u = String(url);
			if (u.includes('lite-api.jup.ag')) return ok({});
			if (u.includes('pump.fun/coins')) return pumpRoute(u, {}); // no market cap / supply
			throw new Error('unexpected url ' + u);
		});
		vi.stubGlobal('fetch', fetchMock);
		expect(await solanaMintUsdPrice(MINT)).toBe(0);
	});
});
