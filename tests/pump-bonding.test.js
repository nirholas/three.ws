import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// api/_lib/pump-bonding.js now reads/writes through api/_lib/cache.js (live +
// last-known-good tiers). Fake it with a plain Map so getBondingStatus's cache
// behavior is tested without Redis: same pattern as
// tests/api/pump-feed-fetch.test.js, which proved this approach for the
// sibling pump.fun readers.
const cache = new Map();
vi.mock('../api/_lib/cache.js', () => ({
	cacheGet: async (k) => (cache.has(k) ? cache.get(k) : null),
	cacheSet: async (k, v) => { cache.set(k, v); },
}));

import {
	bondingProgressPct,
	mapBondingStatus,
	isPumpLaunch,
	PUMP_CURVE_INITIAL_REAL_TOKENS,
	getBondingStatus,
} from '../api/_lib/pump-bonding.js';

// Synthetic pump.fun coin objects. No real third-party mint — $THREE's CA is the
// platform's own coin; the reserves are illustrative curve states.
const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

describe('bondingProgressPct — curve math', () => {
	it('is 0 at launch (full curve float unsold)', () => {
		expect(bondingProgressPct(PUMP_CURVE_INITIAL_REAL_TOKENS)).toBe(0);
	});

	it('is 50 when half the float has been bought out', () => {
		expect(bondingProgressPct(PUMP_CURVE_INITIAL_REAL_TOKENS / 2)).toBeCloseTo(50, 6);
	});

	it('is 100 when the curve float is fully sold', () => {
		expect(bondingProgressPct(0)).toBe(100);
	});

	it('accepts string reserves (feed returns strings)', () => {
		expect(bondingProgressPct(String(PUMP_CURVE_INITIAL_REAL_TOKENS / 4))).toBeCloseTo(75, 6);
	});

	it('clamps out-of-range reserves into 0–100', () => {
		// More reserves than the initial float would compute negative → clamp to 0.
		expect(bondingProgressPct(PUMP_CURVE_INITIAL_REAL_TOKENS * 2)).toBe(0);
	});

	it('returns null when reserves are unknown/invalid', () => {
		expect(bondingProgressPct(null)).toBeNull();
		expect(bondingProgressPct(undefined)).toBeNull();
		expect(bondingProgressPct('not-a-number')).toBeNull();
		expect(bondingProgressPct(-5)).toBeNull();
	});
});

describe('isPumpLaunch — native launch vs externally-indexed token', () => {
	it('accepts a coin with a bonding-curve account', () => {
		expect(isPumpLaunch({ mint: THREE_MINT, bonding_curve: 'BcAcct1111' })).toBe(true);
	});

	it('accepts a coin with live curve reserves', () => {
		expect(isPumpLaunch({ mint: THREE_MINT, virtual_token_reserves: '1073000000000000' })).toBe(true);
	});

	it('accepts a `pump`-suffixed mint as a corroborator', () => {
		expect(isPumpLaunch({ mint: THREE_MINT })).toBe(true); // ends in "pump"
	});

	it('rejects an externally-indexed token even if it carries a bonding_curve field', () => {
		// pump.fun indexes WSOL/USDC/cross-chain tokens with indexed_by_pump — not launches.
		expect(isPumpLaunch({ mint: 'So11111111111111111111111111111111111111112', indexed_by_pump: true, bonding_curve: 'x' })).toBe(false);
	});

	it('rejects a bare non-pump mint with no curve signal', () => {
		expect(isPumpLaunch({ mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' })).toBe(false);
		expect(isPumpLaunch(null)).toBe(false);
		expect(isPumpLaunch({})).toBe(false);
	});
});

describe('mapBondingStatus — on-curve branch', () => {
	const coin = {
		mint: THREE_MINT,
		complete: false,
		real_token_reserves: String(PUMP_CURVE_INITIAL_REAL_TOKENS / 4), // 75% bought out
		real_sol_reserves: String(42 * 1e9), // 42 SOL in the curve
		usd_market_cap: 51234.5,
	};

	it('reports live curve fields and progress', () => {
		const s = mapBondingStatus(coin);
		expect(s.onCurve).toBe(true);
		expect(s.graduated).toBe(false);
		expect(s.migratedTo).toBeNull();
		expect(s.bondingProgressPct).toBeCloseTo(75, 6);
		expect(s.solInCurve).toBeCloseTo(42, 6);
		expect(s.tokensRemaining).toBeCloseTo(PUMP_CURVE_INITIAL_REAL_TOKENS / 4 / 1e6, 6);
		expect(s.marketCapUsd).toBe(51234.5);
		expect(s.source).toBe('pumpfun');
	});

	it('derives USD market cap from SOL cap when usd_market_cap is absent', () => {
		const s = mapBondingStatus(
			{ ...coin, usd_market_cap: undefined, market_cap: 100 },
			{ solPriceUsd: 150 },
		);
		expect(s.marketCapUsd).toBe(15000);
	});

	it('leaves curve fields null when reserves are missing (never throws)', () => {
		const s = mapBondingStatus({ mint: THREE_MINT, complete: false });
		expect(s.onCurve).toBe(true);
		expect(s.bondingProgressPct).toBeNull();
		expect(s.solInCurve).toBeNull();
		expect(s.tokensRemaining).toBeNull();
	});
});

describe('mapBondingStatus — graduated branch', () => {
	it('nulls the curve fields, pins progress to 100, reports the venue (complete flag)', () => {
		const s = mapBondingStatus({
			mint: THREE_MINT,
			complete: true,
			real_token_reserves: '0',
			real_sol_reserves: '0',
			usd_market_cap: 69000,
		});
		expect(s.graduated).toBe(true);
		expect(s.onCurve).toBe(false);
		expect(s.bondingProgressPct).toBe(100);
		expect(s.solInCurve).toBeNull();
		expect(s.tokensRemaining).toBeNull();
		expect(s.migratedTo).toBe('pumpswap'); // default AMM when no explicit pool field
		expect(s.marketCapUsd).toBe(69000);
	});

	it('detects Raydium migration from raydium_pool', () => {
		const s = mapBondingStatus({
			mint: THREE_MINT,
			complete: true,
			raydium_pool: 'RayPoolPlaceholder1111111111111111111111111',
		});
		expect(s.graduated).toBe(true);
		expect(s.migratedTo).toBe('raydium');
	});

	it('detects PumpSwap migration from pump_swap_pool even without the complete flag', () => {
		const s = mapBondingStatus({
			mint: THREE_MINT,
			complete: false,
			pump_swap_pool: 'PumpSwapPoolPlaceholder11111111111111111111',
		});
		expect(s.graduated).toBe(true);
		expect(s.onCurve).toBe(false);
		expect(s.migratedTo).toBe('pumpswap');
	});

});
// getBondingStatus: live cache / last-known-good fallback. Bug: before this,
// a failed upstream fetch always returned `{kind:'upstream_down'}`, even when
// a prior successful fetch for the same mint existed -- the live production
// outage this suite reproduces.
function jsonRes(body, status = 200) {
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: { get: () => null },
		json: async () => body,
	};
}

const bondingCoin = {
	mint: THREE_MINT,
	complete: false,
	real_token_reserves: String(PUMP_CURVE_INITIAL_REAL_TOKENS / 2),
	real_sol_reserves: String(21 * 1e9),
	usd_market_cap: 30000,
};

beforeEach(() => {
	cache.clear();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('getBondingStatus -- cache + last-known-good fallback', () => {
	it('reproduces the outage: upstream down, no last-known-good, reports upstream_down', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')));
		const out = await getBondingStatus(THREE_MINT);
		expect(out).toEqual({ kind: 'upstream_down' });
	});

	it('the bug: upstream down but a last-known-good copy exists, serves it stale instead of failing', async () => {
		const status = mapBondingStatus(bondingCoin);
		cache.set(`pump:bonding:lkg:${THREE_MINT}`, { status, coin: bondingCoin });
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')));

		const out = await getBondingStatus(THREE_MINT);
		expect(out.kind).toBe('ok');
		expect(out.stale).toBe(true);
		expect(out.status).toEqual(status);
		expect(out.coin).toEqual(bondingCoin);
	});

	it('a successful fetch writes through to both the live and last-known-good caches', async () => {
		const fetchMock = vi.fn().mockResolvedValue(jsonRes(bondingCoin));
		vi.stubGlobal('fetch', fetchMock);

		const out = await getBondingStatus(THREE_MINT);
		expect(out.kind).toBe('ok');
		expect(out.stale).toBe(false);
		expect(fetchMock).toHaveBeenCalledTimes(1); // coins-v2 hit, coins never tried

		const live = cache.get(`pump:bonding:live:${THREE_MINT}`);
		const lkg = cache.get(`pump:bonding:lkg:${THREE_MINT}`);
		expect(live.coin).toEqual(bondingCoin);
		expect(lkg.coin).toEqual(bondingCoin);
	});

	it('serves a second request for the same mint from the live cache without a second fetch', async () => {
		const fetchMock = vi.fn().mockResolvedValue(jsonRes(bondingCoin));
		vi.stubGlobal('fetch', fetchMock);

		await getBondingStatus(THREE_MINT);
		const out = await getBondingStatus(THREE_MINT);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(out.kind).toBe('ok');
		expect(out.stale).toBe(false);
	});

	it('not_found is never masked by a stale cache', async () => {
		cache.set(`pump:bonding:lkg:${THREE_MINT}`, { status: mapBondingStatus(bondingCoin), coin: bondingCoin });
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes(null, 404)));

		const out = await getBondingStatus(THREE_MINT);
		expect(out).toEqual({ kind: 'not_found' });
	});
});
