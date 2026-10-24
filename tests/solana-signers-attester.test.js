// The reasoning-ledger attester wallet (ATTEST_AGENT_SECRET_KEY) must be
// registered in SOLANA_SIGNERS so treasury-topup.js and relayer-balance-check.js
// can see and auto-fund it. Before this entry existed, the wallet was invisible
// to both self-heal mechanisms: it could run dry forever with nothing noticing
// or refilling it, which is exactly what happened in production (10k+ repeats
// of the generic "anchoring is down" alert, never the specific low-balance one).

import { describe, it, expect } from 'vitest';
import { SOLANA_SIGNERS } from '../api/_lib/solana-signers.js';

describe('SOLANA_SIGNERS: reasoning-ledger attester', () => {
	it('contains exactly one entry for ATTEST_AGENT_SECRET_KEY', () => {
		const matches = SOLANA_SIGNERS.filter((s) => s.env === 'ATTEST_AGENT_SECRET_KEY');
		expect(matches).toHaveLength(1);
	});

	it('is a memo-only signer with a small floor and refill target', () => {
		const spec = SOLANA_SIGNERS.find((s) => s.env === 'ATTEST_AGENT_SECRET_KEY');
		expect(spec.minSol).toBe(0.02);
		expect(spec.refillTo).toBe(0.05);
		expect(spec.network).toBe('mainnet');
		expect(spec.holdsTokens).toBeFalsy();
		expect(spec.isMaster).toBeFalsy();
	});
});
