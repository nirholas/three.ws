// A citizen's Agora wallet must report the $THREE it actually holds.
//
// $THREE (FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump) is a Token-2022 mint, so
// a holder's balance sits in the Token-2022 associated token account. The read
// used to derive the classic-program ATA, which never exists for $THREE, and its
// not-found fallback turned that into 0: every mainnet holder read as empty, the
// HUD showed 0 $THREE, and posting a bounty was refused as insufficient funds.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';

const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

const balances = vi.hoisted(() => new Map());

vi.mock('../api/_lib/db.js', () => ({ sql: vi.fn() }));
vi.mock('../api/_lib/token/config.js', () => ({ TOKEN_MINT: THREE_MINT, TOKEN_DECIMALS: 6 }));
vi.mock('../api/_lib/agent-wallet.js', () => ({
	generateSolanaAgentWallet: vi.fn(),
	getSolanaAddressBalances: vi.fn(async () => ({ sol: 0.5 })),
}));
vi.mock('../api/_lib/agent-pumpfun.js', () => ({
	solanaConnection: () => ({
		getTokenAccountBalance: async (ata) => {
			const amount = balances.get(ata.toBase58());
			if (amount === undefined) throw new Error('could not find account');
			return { value: { uiAmount: amount } };
		},
	}),
}));

const { citizenBalances } = await import('../api/_lib/agora-human.js');

beforeEach(() => balances.clear());

describe('citizenBalances on mainnet', () => {
	it("reads $THREE from the holder's Token-2022 associated token account", async () => {
		const owner = Keypair.generate().publicKey;
		const ata = getAssociatedTokenAddressSync(new PublicKey(THREE_MINT), owner, true, TOKEN_2022_PROGRAM_ID);
		balances.set(ata.toBase58(), 25_000);
		const out = await citizenBalances({ meta: { solana_address: owner.toBase58() } }, 'mainnet');
		expect(out).toEqual({ sol: 0.5, three: 25_000, address: owner.toBase58() });
	});

	it('reports 0 $THREE for a wallet that has never held it', async () => {
		const owner = Keypair.generate().publicKey;
		const out = await citizenBalances({ meta: { solana_address: owner.toBase58() } }, 'mainnet');
		expect(out.three).toBe(0);
	});
});
