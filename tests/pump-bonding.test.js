import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// api/_lib/pump-bonding.js now reads/writes through api/_lib/cache.js (live +
// last-known-good tiers). Fake it with a plain Map so getBondingStatus's cache
// behavior is tested without Redis: same pattern as
// tests/api/pump-feed-fetch.test.js, which proved this approach for the
// sibling pump.fun readers.
const cache = new Map();
// Tracks every cacheSet call's (key, ttl) so tests can assert on the TTL
// argument the LKG writes use, not just the stored value.
const cacheSetCalls = [];
vi.mock('../api/_lib/cache.js', () => ({
	cacheGet: async (k) => (cache.has(k) ? cache.get(k) : null),
	cacheSet: async (k, v, ttl) => { cacheSetCalls.push({ key: k, ttl }); cache.set(k, v); },
}));

// The on-chain fallback (getCurveView) is the proven reader already live
// behind /api/pump/curve; it is mocked here so this suite stays a unit test
// of getBondingStatus's branching, not an RPC integration test.
vi.mock('../api/_lib/pump-curve-view.js', () => ({
	getCurveView: vi.fn(),
}));

import {
	bondingProgressPct,
	mapBondingStatus,
	mapOnchainCurveView,
	isPumpLaunch,
	PUMP_CURVE_INITIAL_REAL_TOKENS,
	getBondingStatus,
} from '../api/_lib/pump-bonding.js';
import { getCurveView } from '../api/_lib/pump-curve-view.js';

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

describe('mapOnchainCurveView -- pure mapping of getCurveView() output', () => {
	it('maps an on-curve getCurveView body to the shared status shape, tagged onchain', () => {
		const s = mapOnchainCurveView({
			curve: {
				realTokenReserves: String(PUMP_CURVE_INITIAL_REAL_TOKENS / 4),
				realSolReserves: String(42 * 1e9),
			},
		});
		expect(s.onCurve).toBe(true);
		expect(s.graduated).toBe(false);
		expect(s.migratedTo).toBeNull();
		expect(s.bondingProgressPct).toBeCloseTo(75, 6);
		expect(s.solInCurve).toBeCloseTo(42, 6);
		expect(s.tokensRemaining).toBeCloseTo(PUMP_CURVE_INITIAL_REAL_TOKENS / 4 / 1e6, 6);
		expect(s.marketCapUsd).toBeNull(); // body.price is SOL-denominated, no USD leg on this branch
		expect(s.source).toBe('onchain');
	});

	it('maps a graduated getCurveView body (curve account closed) with the Jupiter-backed market cap', () => {
		const s = mapOnchainCurveView({
			curve: null,
			graduated: true,
			graduatedPrice: { priceUsd: 0.0003, source: 'jupiter', marketCapUsd: 300_000 },
		});
		expect(s.graduated).toBe(true);
		expect(s.onCurve).toBe(false);
		expect(s.bondingProgressPct).toBe(100);
		expect(s.solInCurve).toBeNull();
		expect(s.tokensRemaining).toBeNull();
		expect(s.marketCapUsd).toBe(300_000);
		expect(s.migratedTo).toBe('pumpswap'); // on-chain curve account never carries raydium_pool/pump_swap_pool
		expect(s.source).toBe('onchain');
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
	cacheSetCalls.length = 0;
	// Default: the on-chain reader also has nothing for this mint, so tests
	// that don't care about the fallback see the pre-fallback upstream_down
	// behavior unless they override this mock.
	getCurveView.mockReset().mockResolvedValue({
		httpStatus: 404,
		body: { error: 'no_curve', error_description: 'no bonding curve found for that mint' },
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('getBondingStatus -- cache + last-known-good fallback', () => {
	it('the true double failure: upstream down, no last-known-good, on-chain reader also has nothing, reports upstream_down', async () => {
		// Narrowed from the original "reproduces the outage" regression test now
		// that a successful on-chain read fires on this path (see the two tests
		// below): this case pins down that upstream_down is still reported, and
		// reported cleanly, when BOTH the pump.fun fetch and the on-chain fallback
		// come up empty, not just the former.
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')));
		const out = await getBondingStatus(THREE_MINT);
		expect(out).toEqual({ kind: 'upstream_down' });
		expect(getCurveView).toHaveBeenCalledWith({ mint: THREE_MINT, network: 'mainnet' });
	});

	it('on-chain fallback: upstream down, no last-known-good, serves the on-curve bonding state read straight off Solana RPC', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')));
		getCurveView.mockResolvedValue({
			httpStatus: 200,
			body: {
				mint: THREE_MINT,
				network: 'mainnet',
				curve: {
					virtualTokenReserves: '500000000000000',
					virtualSolReserves: '50000000000',
					realTokenReserves: String(PUMP_CURVE_INITIAL_REAL_TOKENS / 2),
					realSolReserves: String(21 * 1e9),
					tokenTotalSupply: '1000000000000000',
					complete: false,
					creator: '9wgvwps9qK5jNniC5RJdrYCfaV3CLKTnxYVqBjXwegEV',
					isMayhemMode: false,
				},
				price: { priceSol: '0.0001', marketCapSol: '1000' },
				graduation: { isGraduated: false, progressBps: 5000 },
			},
		});

		const out = await getBondingStatus(THREE_MINT);
		expect(out.kind).toBe('ok');
		expect(out.stale).toBe(false);
		expect(out.coin).toBeNull();
		expect(out.status.source).toBe('onchain');
		expect(out.status.onCurve).toBe(true);
		expect(out.status.graduated).toBe(false);
		expect(out.status.bondingProgressPct).toBeCloseTo(50, 6);
		expect(out.status.solInCurve).toBeCloseTo(21, 6);
		expect(out.status.tokensRemaining).toBeCloseTo(PUMP_CURVE_INITIAL_REAL_TOKENS / 2 / 1e6, 6);

		// Written through to the last-known-good tier (not the pump.fun live
		// tier, which means "pump.fun answered this recently") so a repeat poll
		// inside the LKG window doesn't re-hit RPC.
		expect(cache.get(`pump:bonding:live:${THREE_MINT}`)).toBeUndefined();
		const lkg = cache.get(`pump:bonding:lkg:${THREE_MINT}`);
		expect(lkg.status.source).toBe('onchain');
	});

	it('on-chain fallback: upstream down, no last-known-good, serves the graduated state with its Jupiter-backed market cap', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')));
		getCurveView.mockResolvedValue({
			httpStatus: 200,
			body: {
				mint: THREE_MINT,
				network: 'mainnet',
				curve: null,
				graduated: true,
				price: null,
				graduation: { isGraduated: true, progressBps: 10_000 },
				graduatedPrice: { priceUsd: 0.00029683255767706676, source: 'jupiter', marketCapUsd: 296832.55767706677 },
			},
		});

		const out = await getBondingStatus(THREE_MINT);
		expect(out.kind).toBe('ok');
		expect(out.stale).toBe(false);
		expect(out.status.source).toBe('onchain');
		expect(out.status.graduated).toBe(true);
		expect(out.status.onCurve).toBe(false);
		expect(out.status.bondingProgressPct).toBe(100);
		expect(out.status.solInCurve).toBeNull();
		expect(out.status.tokensRemaining).toBeNull();
		expect(out.status.marketCapUsd).toBeCloseTo(296832.55767706677, 3);
		expect(out.status.migratedTo).toBe('pumpswap');
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

	it('writes the LKG cache entry (successful-fetch call site) with a TTL that survives a multi-hour outage, not just 30 minutes', async () => {
		// The LKG tier exists to survive hours-long outages (a 6h RPC-lane
		// cooldown, a multi-day Cloudflare block on pump.fun's frontend), so a
		// 1800s (30min) TTL expires long before those windows close.
		const fetchMock = vi.fn().mockResolvedValue(jsonRes(bondingCoin));
		vi.stubGlobal('fetch', fetchMock);

		await getBondingStatus(THREE_MINT);

		const lkgWrite = cacheSetCalls.find((c) => c.key === `pump:bonding:lkg:${THREE_MINT}`);
		expect(lkgWrite).toBeDefined();
		expect(lkgWrite.ttl).toBeGreaterThanOrEqual(21600);
	});

	it('writes the LKG cache entry (on-chain-fallback call site) with the same >= 6h TTL', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')));
		getCurveView.mockResolvedValue({
			httpStatus: 200,
			body: {
				curve: {
					realTokenReserves: String(PUMP_CURVE_INITIAL_REAL_TOKENS / 2),
					realSolReserves: String(21 * 1e9),
				},
			},
		});

		await getBondingStatus(THREE_MINT);

		const lkgWrite = cacheSetCalls.find((c) => c.key === `pump:bonding:lkg:${THREE_MINT}`);
		expect(lkgWrite).toBeDefined();
		expect(lkgWrite.ttl).toBeGreaterThanOrEqual(21600);
	});
});
