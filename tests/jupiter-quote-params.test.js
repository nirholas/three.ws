// Jupiter quote URLs are built from a validated mint and encoded parameters.
//
// The autopilot and wallet-intent swap paths interpolated the output mint raw
// into the quote query, so a mint string like `<mint>&slippageBps=10000` rewrote
// the slippage (or amount) of the quote the agent wallet then signed.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../api/_lib/db.js', () => ({ sql: vi.fn(async () => []) }));

const THREE = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

for (const mod of ['../api/_lib/treasury-autopilot.js', '../api/_lib/wallet-intents.js']) {
	describe(`jupiterQuoteParams in ${mod}`, async () => {
		const { jupiterQuoteParams } = await import(mod);

		it('builds an encoded query for a real mint', () => {
			const q = new URLSearchParams(jupiterQuoteParams({ outputMint: THREE, lamports: 1000n, slippageBps: 300 }));
			expect(q.get('outputMint')).toBe(THREE);
			expect(q.get('slippageBps')).toBe('300');
			expect(q.get('amount')).toBe('1000');
			expect(q.getAll('slippageBps')).toHaveLength(1);
		});

		it('refuses a mint carrying extra query parameters', () => {
			expect(() => jupiterQuoteParams({ outputMint: `${THREE}&slippageBps=10000`, lamports: 1000n, slippageBps: 50 }))
				.toThrow(/valid Solana address/);
		});

		it('refuses an out-of-range slippage', () => {
			expect(() => jupiterQuoteParams({ outputMint: THREE, lamports: 1n, slippageBps: 20_000 })).toThrow(/slippage/);
		});
	});
}
