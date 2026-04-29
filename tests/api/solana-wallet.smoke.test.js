// Devnet smoke test for the solana-wallet skill + ctx.wallet contract.
//
// Verifies the full path: generate encrypted keypair → loadWallet → fund via
// devnet airdrop → transferSol round-trip → balance check.
//
// Skipped by default. Enable with:
//   SOLANA_DEVNET_SMOKE=1 SOLANA_DEVNET_RPC=https://api.devnet.solana.com npx vitest run tests/api/solana-wallet.smoke.test.js
//
// Devnet airdrops are flaky/rate-limited; allow ~60s.

import { describe, it, expect } from 'vitest';
import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';

import { generateSolanaAgentWallet } from '../../api/_lib/agent-wallet.js';
import { loadWallet } from '../../api/_lib/solana-wallet.js';
import {
	getAddress,
	getBalance,
	transferSol,
} from '../../examples/skills/solana-wallet/handlers.js';

const ENABLED = process.env.SOLANA_DEVNET_SMOKE === '1';
const RPC = process.env.SOLANA_DEVNET_RPC ?? 'https://api.devnet.solana.com';

const maybe = ENABLED ? describe : describe.skip;

maybe('solana-wallet (devnet smoke)', () => {
	it('round-trips: generate → airdrop → transferSol → balance', async () => {
		// Need JWT_SECRET for the encrypt/decrypt path.
		process.env.JWT_SECRET ??= 'devnet-smoke-secret';

		const { encrypted_secret, address } = await generateSolanaAgentWallet();
		const wallet = await loadWallet(encrypted_secret);
		expect(wallet.publicKey.toBase58()).toBe(address);

		const ctx = { wallet, skillConfig: { rpc: RPC, maxTransferSol: 1 } };

		const addr = await getAddress({}, ctx);
		expect(addr.ok).toBe(true);
		expect(addr.data.address).toBe(address);

		// Airdrop 0.5 SOL to fund the test.
		const conn = new Connection(RPC, 'confirmed');
		const sig = await conn.requestAirdrop(wallet.publicKey, 0.5 * LAMPORTS_PER_SOL);
		const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
		await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');

		const balBefore = await getBalance({}, ctx);
		expect(balBefore.data.sol).toBeGreaterThan(0.4);

		// Transfer 0.01 to a throwaway recipient.
		const recipient = Keypair.generate();
		const xfer = await transferSol(
			{ to: recipient.publicKey.toBase58(), amountSol: 0.01 },
			ctx,
		);
		expect(xfer.ok).toBe(true);
		expect(typeof xfer.data.sig).toBe('string');

		const recipBal = await getBalance({ address: recipient.publicKey.toBase58() }, ctx);
		expect(recipBal.data.sol).toBeCloseTo(0.01, 4);
	}, 90_000);

	it('rejects transferSol over the cap', async () => {
		process.env.JWT_SECRET ??= 'devnet-smoke-secret';
		const { encrypted_secret } = await generateSolanaAgentWallet();
		const wallet = await loadWallet(encrypted_secret);
		const ctx = { wallet, skillConfig: { rpc: RPC, maxTransferSol: 0.001 } };
		const recipient = Keypair.generate();
		const res = await transferSol(
			{ to: recipient.publicKey.toBase58(), amountSol: 1 },
			ctx,
		);
		expect(res.ok).toBe(false);
		expect(res.error).toMatch(/exceeds cap/);
	});
});
