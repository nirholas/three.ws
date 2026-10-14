import { describe, it, expect } from 'vitest';
import { Keypair } from '@solana/web3.js';

// enforceCap() required `requirement.amount`, which is the v2 field name.
// A v1 payment requirement (the wire format most of the open x402 bazaar and
// the owner's x402-suite still speak) carries the price in
// `maxAmountRequired` instead, so every v1 payment hit
// "spending-cap: requirement.amount required" and could never be admitted at
// all, defeating the point of registering v1 support in the buyer. This test
// reproduces that, then (after the fix) proves a v1 requirement is admitted
// and capped exactly like a v2 one.

const { enforceCap } = await import('../api/_lib/x402-spending-cap.js');

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const address = Keypair.generate().publicKey.toBase58();

function v1Requirement(maxAmountRequired) {
	return {
		scheme: 'exact',
		network: 'solana',
		maxAmountRequired,
		asset: USDC,
		payTo: Keypair.generate().publicKey.toBase58(),
		maxTimeoutSeconds: 60,
		extra: { name: 'USDC', decimals: 6 },
	};
}

describe('enforceCap: v1 requirements (maxAmountRequired)', () => {
	it('admits an in-cap v1 payment instead of throwing on the missing `amount` field', async () => {
		const res = await enforceCap({
			requirement: v1Requirement('1000'), // $0.001 USDC, well under the per-call cap
			opts: { address, maxPerCall: '100000', strict: false },
		});
		expect(res.abort).toBe(false);
	});

	it('still refuses an over-cap v1 payment (the cap is enforced, not bypassed)', async () => {
		const res = await enforceCap({
			requirement: v1Requirement('5000000'), // $5.00 USDC, far over the cap
			opts: { address, maxPerCall: '100000', strict: false },
		});
		expect(res.abort).toBe(true);
		expect(res.reason).toMatch(/exceeds per-call cap/);
	});
});
