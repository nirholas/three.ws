// Unit tests for the Oracle live-market aggregator (api/_lib/oracle/market.js).
// mergeMarketSources is pure (no network/clock), so it's tested directly against
// fixtures; fetchCoinMarket is exercised with a URL-routing fetch mock so no
// network is touched and per-source failover / precedence is verified.
//
// Mints used are $THREE (the platform's own promoted coin) and a clearly
// synthetic non-pump address — never a real third-party mint.

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

// pump.fun's search rows no longer carry the bonding-curve reserves, so an
// on-curve coin's progress is read off the curve account on Solana.
const curveView = vi.hoisted(() => ({ fn: async () => ({ httpStatus: 404, body: { error: 'no_curve' } }) }));
vi.mock('../../api/_lib/pump-curve-view.js', () => ({ getCurveView: (...a) => curveView.fn(...a) }));

import { mergeMarketSources, fetchCoinMarket, __resetCoinMarketCache } from '../../api/_lib/oracle/market.js';

const THREE = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const SYNTH = 'SoMeSyntheticNonPumpMint1111111111111111111';
const AT = '2026-07-02T00:00:00.000Z';

const realFetch = global.fetch;
afterAll(() => { global.fetch = realFetch; });

describe('mergeMarketSources', () => {
	it('fuses fields with source precedence (Dex price/change, Gecko supply, GoPlus security, CG listing, pump curve)', () => {
		const dex = {
			sources: ['dexscreener'],
			identity: { name: 'three.ws', symbol: 'three', image: 'dex.png' },
			price_usd: 0.0021, price_native: 0.000027,
			change: { m5: -1, h1: -3, h6: -2, h24: 5 },
			volume: { m5: 10, h1: 100, h6: 1000, h24: 465000 },
			txns: { h24: { buys: 20, sells: 5 } },
			liquidity_usd: 223000, market_cap_usd: 2100000, fdv_usd: 2100000,
			links: { website: 'https://three.ws/', twitter: 'https://x.com/trythreews', telegram: null },
			pairs: [{ dex: 'pumpswap', url: 'https://dexscreener.com/solana/x', liquidity_usd: 223000 }],
		};
		const pump = {
			sources: ['pumpfun'], identity: { name: 'three.ws', symbol: 'three', description: 'give your ai model a life' },
			links: { website: 'https://three.ws/', twitter: 'https://x.com/launch/status/1', telegram: null },
			creator: 'CreatorWallet', created_at: '2026-04-29T05:41:49.000Z', supply_total: 1_000_000_000,
			pumpfun: { is_pump: true, complete: true, graduated: true, bonding_curve_pct: 100, ath_market_cap_usd: 16_000_000 },
		};
		const gecko = {
			sources: ['geckoterminal'], identity: { decimals: 6 },
			price_usd: 0.00211, market_cap_usd: 2_105_000, fdv_usd: 2_105_000,
			volume: { h24: 769000 }, liquidity_usd: 158000, supply_total: 999_687_956, coingecko_id: 'three-ws',
		};
		const goplus = {
			sources: ['goplus'], holders: 12943, supply_total: 999_688_101,
			security: { mint_authority_revoked: true, freeze_authority_revoked: true, metadata_mutable: false, transfer_fee_pct: 0, top10_holder_pct: 17.34, source: 'goplus' },
			top_holders: [{ account: 'poolAcct', pct: 3.37, is_locked: false, tag: null }],
		};
		const birdeye = { sources: ['birdeye'], price_usd: 0.0020, holders: 12000, supply_circulating: 999_000_000 };
		const coingecko = { sources: ['coingecko'], listing: { coingecko_id: 'three-ws', market_cap_rank: 2181, categories: ['AI'], ath_usd: 0.0149, ath_change_pct: -85, atl_usd: 0.00005 } };

		const m = mergeMarketSources(THREE, 'mainnet', { dex, pump, gecko, goplus, birdeye, coingecko }, AT);

		// Price + native from DexScreener (highest precedence), not Birdeye/Gecko.
		expect(m.price.usd).toBe(0.0021);
		expect(m.price.native_sol).toBe(0.000027);
		// Every change window threads through.
		expect(m.price.change).toMatchObject({ m5: -1, h1: -3, h6: -2, h24: 5 });
		// Market cap/liquidity/volume from richest source.
		expect(m.market_cap_usd).toBe(2100000);
		expect(m.liquidity_usd).toBe(223000);
		expect(m.volume.h24).toBe(465000);
		// Supply prefers Gecko's normalized value.
		expect(m.supply.total).toBe(999_687_956);
		expect(m.supply.circulating).toBe(999_000_000);
		// Holders from GoPlus (over Birdeye).
		expect(m.holders).toBe(12943);
		// Activity rolled up from Dex txns.
		expect(m.activity.buys_24h).toBe(20);
		expect(m.activity.txns_24h).toBe(25);
		expect(m.activity.buy_ratio).toBeCloseTo(0.8, 5);
		// Security from GoPlus.
		expect(m.security.mint_authority_revoked).toBe(true);
		expect(m.security.top10_holder_pct).toBe(17.34);
		// Listing from CoinGecko.
		expect(m.listing.market_cap_rank).toBe(2181);
		expect(m.listing.ath_usd).toBe(0.0149);
		// pump.fun graduated truth.
		expect(m.pumpfun.graduated).toBe(true);
		expect(m.pumpfun.bonding_curve_pct).toBe(100);
		// Links: DexScreener's curated handle wins over pump's launch-tweet URL.
		expect(m.links.twitter).toBe('https://x.com/trythreews');
		expect(m.links.solscan).toContain(THREE);
		// Identity name/description fused across sources.
		expect(m.identity.name).toBe('three.ws');
		expect(m.identity.description).toContain('give your ai model');
		expect(m.identity.creator).toBe('CreatorWallet');
		expect(m.sources).toEqual(expect.arrayContaining(['dexscreener', 'pumpfun', 'geckoterminal', 'goplus', 'coingecko']));
	});

	it('degrades gracefully when only one source is present', () => {
		const dex = { sources: ['dexscreener'], identity: { symbol: 'X' }, price_usd: 0.5, change: {}, volume: {}, pairs: [], links: {} };
		const m = mergeMarketSources(SYNTH, 'mainnet', { dex, pump: null, gecko: null, goplus: null, birdeye: null, coingecko: null }, AT);
		expect(m.price.usd).toBe(0.5);
		expect(m.holders).toBeNull();
		expect(m.security).toBeNull();
		expect(m.listing).toBeNull();
		// Non-pump synthetic mint → no pumpfun block fabricated.
		expect(m.pumpfun).toBeNull();
		expect(m.links.dexscreener).toContain(SYNTH);
	});

	it('marks a *pump mint as a pump coin even without a pump.fun read', () => {
		const dex = { sources: ['dexscreener'], identity: {}, price_usd: 1, change: {}, volume: {}, pairs: [], links: {} };
		const m = mergeMarketSources(THREE, 'mainnet', { dex, pump: null, gecko: null, goplus: null, birdeye: null, coingecko: null }, AT);
		expect(m.pumpfun).toMatchObject({ is_pump: true });
	});
});

// ── fetchCoinMarket: URL-routing fetch mock ──────────────────────────────────

function jres(obj, ok = true, status = 200) {
	return { ok, status, json: async () => obj, text: async () => JSON.stringify(obj) };
}

describe('fetchCoinMarket', () => {
	beforeEach(() => { __resetCoinMarketCache(); process.env.BIRDEYE_API_KEY = 'test-key'; });

	it('fuses live sources and only calls CoinGecko once Gecko proves a listing', async () => {
		const cgCalls = [];
		global.fetch = vi.fn(async (url) => {
			const u = String(url);
			if (u.includes('dexscreener.com')) return jres({ pairs: [{ chainId: 'solana', dexId: 'pumpswap', url: 'https://d/x', pairAddress: 'P', baseToken: { name: 'three.ws', symbol: 'three' }, quoteToken: { symbol: 'SOL' }, priceUsd: '0.0021', priceNative: '0.000027', priceChange: { h24: 3 }, volume: { h24: 465000 }, txns: { h24: { buys: 20, sells: 5 } }, liquidity: { usd: 223000 }, marketCap: 2100000, fdv: 2100000, info: { imageUrl: 'i.png', socials: [{ type: 'twitter', url: 'https://x.com/trythreews' }], websites: [{ url: 'https://three.ws/' }] } }] });
			// pump.fun serves a coin from its search route only (GET /coins/<mint> and
			// /coins-v2/<mint> answer 404 since 2026-11-25).
			if (u.includes('frontend-api-v3.pump.fun/coins/search-unrestricted') && new URL(u).searchParams.get('searchTerm') === THREE) {
				return jres([{ mint: THREE, name: 'three.ws', symbol: 'three', complete: true, total_supply: 1_000_000_000_000_000, creator: 'C', created_timestamp: 1777441309000, ath_market_cap: 16_000_000 }]);
			}
			if (u.includes('frontend-api-v3.pump.fun')) return jres({ message: 'Cannot GET' }, false, 404);
			if (u.includes('geckoterminal.com')) return jres({ data: { attributes: { decimals: 6, coingecko_coin_id: 'three-ws', normalized_total_supply: '999687956', price_usd: '0.00211', market_cap_usd: '2105000', fdv_usd: '2105000', volume_usd: { h24: '769000' }, total_reserve_in_usd: '158000' } } });
			if (u.includes('gopluslabs.io')) return jres({ result: { [THREE]: { holder_count: 12943, total_supply: 999688101, mintable: { status: '0' }, freezable: { status: '0' }, metadata_mutable: { status: '0' }, transfer_fee: {}, holders: [{ account: 'a', percent: '0.05' }, { account: 'b', percent: '0.03' }] } } });
			if (u.includes('birdeye.so')) return jres({ data: { price: 0.002, holder: 12000, supply: 1_000_000_000, mc: 2_000_000, v24hUSD: 460000, liquidity: 220000 } });
			if (u.includes('api.coingecko.com')) { cgCalls.push(u); return jres({ id: 'three-ws', market_cap_rank: 2181, categories: ['AI'], market_data: { ath: { usd: 0.0149 }, ath_change_percentage: { usd: -85 }, atl: { usd: 0.00005 }, circulating_supply: 999000000 } }); }
			throw new Error(`unexpected url ${u}`);
		});

		const m = await fetchCoinMarket(THREE, 'mainnet', { fresh: true });
		expect(m.price.usd).toBe(0.0021);
		expect(m.holders).toBe(12943);
		expect(m.security.mint_authority_revoked).toBe(true);
		expect(m.pumpfun.graduated).toBe(true);
		expect(m.pumpfun.ath_market_cap_usd).toBe(16_000_000);
		expect(m.listing.market_cap_rank).toBe(2181);
		expect(cgCalls.length).toBe(1); // called exactly once, gated on the gecko id
	});

	it('skips CoinGecko when the token is unlisted (no gecko coingecko_id)', async () => {
		let cgHit = false;
		global.fetch = vi.fn(async (url) => {
			const u = String(url);
			if (u.includes('dexscreener.com')) return jres({ pairs: [{ chainId: 'solana', dexId: 'raydium', url: 'https://d/y', baseToken: { symbol: 'NEW' }, quoteToken: { symbol: 'SOL' }, priceUsd: '0.001', priceChange: {}, volume: {}, liquidity: { usd: 5000 } }] });
			if (u.includes('geckoterminal.com')) return jres({ data: { attributes: { decimals: 6, price_usd: '0.001' } } }); // no coingecko_coin_id
			if (u.includes('gopluslabs.io')) return jres({ result: {} });
			if (u.includes('birdeye.so')) return jres({ data: {} });
			if (u.includes('frontend-api-v3.pump.fun')) return jres({}, false, 404);
			if (u.includes('api.coingecko.com')) { cgHit = true; return jres({}); }
			throw new Error(`unexpected url ${u}`);
		});
		const m = await fetchCoinMarket(SYNTH, 'mainnet', { fresh: true });
		expect(m.price.usd).toBe(0.001);
		expect(cgHit).toBe(false);
		expect(m.listing).toBeNull();
	});

	it('fills an on-curve coin\'s progress from the Solana curve account, since search rows carry no reserves', async () => {
		const ONCURVE = 'THREEsynthetic11111111111111111111111111pump';
		const views = [];
		curveView.fn = async (args) => {
			views.push(args);
			return { httpStatus: 200, body: { curve: { realTokenReserves: 793_100_000 * 1e6 * 0.25, realSolReserves: 63 * 1e9 } } };
		};
		global.fetch = vi.fn(async (url) => {
			const u = String(url);
			if (u.includes('frontend-api-v3.pump.fun/coins/search-unrestricted')) {
				return jres([{ mint: ONCURVE, name: 'synthetic', symbol: 'SYN', complete: false, total_supply: 1_000_000_000_000_000, usd_market_cap: 30000 }]);
			}
			if (u.includes('frontend-api-v3.pump.fun')) return jres({ message: 'Cannot GET' }, false, 404);
			return jres({}, false, 404);
		});
		try {
			const m = await fetchCoinMarket(ONCURVE, 'mainnet', { fresh: true });
			expect(views).toEqual([{ mint: ONCURVE, network: 'mainnet' }]);
			expect(m.pumpfun.complete).toBe(false);
			expect(m.pumpfun.bonding_curve_pct).toBe(75);
			expect(m.pumpfun.real_sol_reserves).toBe(63);
		} finally {
			curveView.fn = async () => ({ httpStatus: 404, body: { error: 'no_curve' } });
		}
	});

	it('returns null when every source is down', async () => {
		global.fetch = vi.fn(async () => { throw new Error('network down'); });
		const m = await fetchCoinMarket(SYNTH, 'mainnet', { fresh: true });
		expect(m).toBeNull();
	});
});
