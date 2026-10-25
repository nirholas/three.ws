// The owner's accrued performance fee sits in the vault's USDC balance until it
// is claimed, but it belongs to the owner, not the backers. NAV and the liquid
// balance used for redemptions must exclude it, or backers redeem the fee out
// from under the owner's claim.

import { describe, it, expect, vi } from 'vitest';
import { Keypair } from '@solana/web3.js';

vi.mock('../api/_lib/agent-pumpfun.js', () => ({
	solanaConnection: () => ({
		getTokenAccountBalance: async () => ({ value: { amount: '1000000' } }),
	}),
}));
vi.mock('../api/_lib/vault-jupiter.js', () => ({
	markToUsdc: async () => 0n,
	USDC_MINT_BY_NETWORK: { mainnet: Keypair.generate().publicKey.toBase58(), devnet: Keypair.generate().publicKey.toBase58() },
}));

const { computeVaultNav } = await import('../api/_lib/vault-wallet.js');

const vault = (accrued) => ({
	network: 'mainnet',
	vault_address: Keypair.generate().publicKey.toBase58(),
	accrued_fee_atomics: accrued,
});

describe('computeVaultNav accrued performance fee', () => {
	it('excludes the unclaimed fee from NAV and liquid USDC', async () => {
		const nav = await computeVaultNav(vault('250000'), []);
		expect(nav.usdcAtomics).toBe(1_000_000n);
		expect(nav.navAtomics).toBe(750_000n);
		expect(nav.freeAtomics).toBe(750_000n);
	});

	it('floors at zero when the accrued fee exceeds the balance', async () => {
		const nav = await computeVaultNav(vault('5000000'), []);
		expect(nav.navAtomics).toBe(0n);
		expect(nav.freeAtomics).toBe(0n);
	});

	it('is unchanged when no fee has accrued', async () => {
		const nav = await computeVaultNav(vault('0'), []);
		expect(nav.navAtomics).toBe(1_000_000n);
	});
});
