// A router that rate-limits or drops the per-venue quotes is an outage, not a
// market reading. Production hit this on 2026-11-03: Jupiter's keyless tier
// answered venue discovery and then returned 429 to every per-venue quote, and
// /arbitrage/quote told the caller "Only 0 venue(s) can fill this pair" (422)
// for SOL/USDC, a pair with dozens of pools. The quote must say the router is
// unavailable (503) instead, the same way an empty discovery during an outage
// already does.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// perVenue: 'rate_limited' (every dexes= quote 429s) or 'one_pool' (Beta has
// no direct pool at this size, a real 400 "no route" answer).
const state = { perVenue: 'rate_limited', calls: 0 };

vi.mock('../api/_lib/token/jupiter.js', () => ({
	jupiterVenueLabels: async () => ({}),
	jupiterQuote: async ({ inputMint, outputMint, amount, dexes, excludeDexes }) => {
		state.calls++;
		if (dexes?.length) {
			if (state.perVenue === 'rate_limited') {
				const e = new Error('upstream 429: {"code":429,"message":"[API Gateway] Too many requests"}');
				e.status = 429;
				throw e;
			}
			if (dexes[0] === 'Beta') {
				const e = new Error('no route');
				e.status = 400;
				throw e;
			}
			return { inAmount: String(amount), outAmount: '1000', priceImpactPct: '0', routePlan: [{ swapInfo: { label: dexes[0], inputMint, outputMint } }] };
		}
		const excluded = new Set(excludeDexes || []);
		const label = ['Alpha', 'Beta'].find((l) => !excluded.has(l));
		if (!label) {
			const e = new Error('no route');
			e.status = 400;
			throw e;
		}
		return { inAmount: String(amount), outAmount: '1000', priceImpactPct: '0', routePlan: [{ swapInfo: { label, inputMint, outputMint } }] };
	},
}));

const { arbitrageQuote } = await import('../api/_lib/trading-tools/arbitrage.js');

// Every call uses a distinct amount so the module's 10s quote cache never
// hands one test another test's answer.
let amount = 7;
beforeEach(() => {
	state.calls = 0;
	amount += 1;
});

describe('arbitrageQuote when the router fails mid-quote', () => {
	it('reports router_unavailable (503), not insufficient_venues, when every venue quote errored', async () => {
		state.perVenue = 'rate_limited';
		const err = await arbitrageQuote({ token: 'SOL', quote: 'USDC', amount }).catch((e) => e);
		expect(err).toBeInstanceOf(Error);
		expect(err.code).toBe('router_unavailable');
		expect(err.status).toBe(503);
		expect(err.message).not.toMatch(/can fill this pair/);
		expect(state.calls).toBeGreaterThan(0);
	});

	it('still reports insufficient_venues when the venues answered and only one has a pool', async () => {
		state.perVenue = 'one_pool';
		const err = await arbitrageQuote({ token: 'SOL', quote: 'USDC', amount }).catch((e) => e);
		expect(err.code).toBe('insufficient_venues');
		expect(err.detail.venues_quoted).toHaveLength(1);
	});
});
