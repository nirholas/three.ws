// Unit tests for the Net-Worth-Reactive Avatar mapping — src/shared/wallet-networth.js.
//
// The visual mapping is the heart of task 07: the agent's 3D body is a PURE
// function of its real wallet state. These tests pin that contract — tier
// thresholds, intensity monotonicity, the whale cap, the dormant baseline, the
// asset-mix palette, and that the same state always yields the same look (no
// randomness, no time input). No network: every input is a plain state object.

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	NETWORTH_TIERS,
	tierForUsd,
	computeWalletVisual,
	dominantAsset,
	walletGlowForUsd,
	formatNetWorth,
	THREE_MINT,
	fetchWalletState,
} from '../src/shared/wallet-networth.js';

const state = (usdTotal, mix = { sol: 1 }, extra = {}) => ({ usdTotal, mix, hasThree: false, ...extra });

describe('tierForUsd', () => {
	it('maps an empty / zero / negative wallet to dormant', () => {
		expect(tierForUsd(0).key).toBe('dormant');
		expect(tierForUsd(-5).key).toBe('dormant');
		expect(tierForUsd(null).key).toBe('dormant');
		expect(tierForUsd(undefined).key).toBe('dormant');
		expect(tierForUsd(NaN).key).toBe('dormant');
	});

	it('crosses each threshold into the next tier', () => {
		expect(tierForUsd(0.5).key).toBe('dormant'); // below the $1 spark line
		expect(tierForUsd(1).key).toBe('spark');
		expect(tierForUsd(24.99).key).toBe('spark');
		expect(tierForUsd(25).key).toBe('ember');
		expect(tierForUsd(250).key).toBe('glow');
		expect(tierForUsd(2_500).key).toBe('radiant');
		expect(tierForUsd(25_000).key).toBe('luminous');
		expect(tierForUsd(5_000_000).key).toBe('luminous');
	});

	it('tier levels are 0..5 and strictly ordered by min', () => {
		expect(NETWORTH_TIERS.map((t) => t.level)).toEqual([0, 1, 2, 3, 4, 5]);
		for (let i = 1; i < NETWORTH_TIERS.length; i++) {
			expect(NETWORTH_TIERS[i].min).toBeGreaterThan(NETWORTH_TIERS[i - 1].min);
		}
	});
});

describe('computeWalletVisual', () => {
	it('dormant wallet renders a clean baseline, never broken', () => {
		const v = computeWalletVisual(state(0));
		expect(v.dormant).toBe(true);
		expect(v.level).toBe(0);
		expect(v.particleDensity).toBe(0);
		expect(v.tier).toBe('dormant');
		expect(typeof v.accent).toBe('string');
		expect(v.accent).toMatch(/^hsl/);
	});

	it('intensity rises monotonically across tiers and is capped at 1', () => {
		const vals = [0, 1, 25, 250, 2_500, 25_000, 10_000_000].map(
			(u) => computeWalletVisual(state(u)).intensity,
		);
		for (let i = 1; i < vals.length; i++) {
			expect(vals[i]).toBeGreaterThanOrEqual(vals[i - 1]);
		}
		expect(vals[vals.length - 1]).toBeLessThanOrEqual(1);
		expect(vals[vals.length - 1]).toBeLessThanOrEqual(computeWalletVisual(state(25_000)).intensity + 1e-9);
	});

	it('caps the whale tier so an enormous balance never overshoots', () => {
		const a = computeWalletVisual(state(25_000));
		const b = computeWalletVisual(state(999_999_999));
		expect(a.capped).toBe(true);
		expect(b.capped).toBe(true);
		expect(b.intensity).toBe(a.intensity); // hard clamp — identical, not brighter
		expect(b.intensity).toBeLessThanOrEqual(1);
	});

	it('is a pure function — identical state yields identical visual', () => {
		const s = state(1_234, { sol: 0.6, three: 0.4 }, { hasThree: true });
		expect(computeWalletVisual(s)).toEqual(computeWalletVisual(s));
	});

	it('particle budget is bounded and tasteful', () => {
		const max = computeWalletVisual(state(10_000_000)).particleDensity;
		expect(max).toBeGreaterThan(0);
		expect(max).toBeLessThanOrEqual(60);
	});

	it('surfaces $THREE holdings without ever rotating off the violet family', () => {
		const withThree = computeWalletVisual(state(500, { three: 1 }, { hasThree: true }));
		const withSol = computeWalletVisual(state(500, { sol: 1 }));
		expect(withThree.hasThree).toBe(true);
		// Both stay in the coherent blue-violet-magenta wallet band: $THREE tilts
		// the violet toward magenta, SOL toward blue-violet — never off into an
		// unrelated hue. (Base violet is 258°; the mix rotates it at most ~±35°.)
		expect(withThree.rimHue).toBeGreaterThan(235);
		expect(withThree.rimHue).toBeLessThan(295);
		expect(withSol.rimHue).toBeGreaterThan(235);
		expect(withSol.rimHue).toBeLessThan(295);
	});
});

describe('dominantAsset', () => {
	it('returns null for an empty wallet', () => {
		expect(dominantAsset(state(0, {}))).toBeNull();
	});
	it('picks the highest-weight asset by real USD proportion', () => {
		expect(dominantAsset(state(100, { sol: 0.2, usdc: 0.1, three: 0.7 }))).toBe('three');
		expect(dominantAsset(state(100, { sol: 0.55, other: 0.45 }))).toBe('sol');
	});
});

describe('walletGlowForUsd (galaxy signal)', () => {
	it('returns a 0..1 wealth scalar matching the tier level', () => {
		expect(walletGlowForUsd(0).wealth).toBe(0);
		expect(walletGlowForUsd(25_000).wealth).toBe(1);
		const g = walletGlowForUsd(250);
		expect(g.wealth).toBeGreaterThan(0);
		expect(g.wealth).toBeLessThan(1);
		expect(g.tier).toBe('glow');
	});
});

describe('formatNetWorth', () => {
	it('formats real values honestly, including a true $0', () => {
		expect(formatNetWorth(state(0))).toBe('$0');
		expect(formatNetWorth(state(12.5))).toBe('$12.50');
		expect(formatNetWorth(state(1_500))).toBe('$1,500');
		expect(formatNetWorth(state(2_000_000))).toBe('$2.00M');
	});
	it('shows an em dash when the price feed is down and value is unknown', () => {
		expect(formatNetWorth({ usdTotal: 0, balanceError: 'price_unavailable' })).toBe('—');
	});
});

describe('THREE_MINT', () => {
	it('is the one and only coin address', () => {
		expect(THREE_MINT).toBe('FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump');
	});
});

describe('fetchWalletState for a wallet-less agent', () => {
	afterEach(() => vi.unstubAllGlobals());

	// The aura re-reads on a timer, so the request opts into the 204 soft miss:
	// a 404 here would print a red console line on every poll for every agent
	// that has not provisioned a wallet yet.
	it('asks for the soft miss and renders a 204 as the clean dormant baseline', async () => {
		const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
		vi.stubGlobal('fetch', fetchMock);
		const out = await fetchWalletState('0f290230-48e0-4a39-9b32-3eb8d10a29a9');
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(new URL(fetchMock.mock.calls[0][0], 'http://x').searchParams.get('miss')).toBe('empty');
		expect(out.usdTotal).toBe(0);
		expect(out.assets).toEqual([]);
		expect(out.balanceError).toBeNull();
	});
});
