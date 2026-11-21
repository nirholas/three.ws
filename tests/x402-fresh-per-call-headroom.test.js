// The per-call fresh payer must not mint a wallet it cannot fund. Before the
// headroom gate, buyerFor minted (and wrote an x402_fresh_wallets row) on every
// ring call, then failed the funding transaction when the fee wallet sat at the
// facilitator's sponsor floor: one orphan row per call, all day.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Keypair } from '@solana/web3.js';

const chain = vi.hoisted(() => ({
	sol: 0,
	usdc: { exists: true, atomic: 0n },
	fundWallets: null,
}));
const mintWallet = vi.hoisted(() => vi.fn());

vi.mock('../api/_lib/x402/fresh-workers/chain.js', () => ({
	rentExemptLamports: async () => 890_880,
	readSolLamports: async () => chain.sol,
	readUsdc: async () => chain.usdc,
	usdcAtaOf: () => Keypair.generate().publicKey,
	fundWallets: (...a) => chain.fundWallets(...a),
	confirmSignature: async () => true,
}));
vi.mock('../api/_lib/x402/fresh-workers/wallets.js', () => ({
	mintWallet,
	markFunded: vi.fn(async () => {}),
	markFundFailed: vi.fn(async () => {}),
	markPaid: vi.fn(async () => {}),
	markPayFailed: vi.fn(async () => {}),
}));
vi.mock('../api/_lib/x402/fresh-workers/run.js', () => ({ settleWallet: vi.fn(async () => ({ state: 'closed' })) }));

const { createFreshCallPayer } = await import('../api/_lib/x402/fresh-workers/per-call.js');
const { SPONSOR_SOL_FLOOR_LAMPORTS } = await import('../api/_lib/x402/self-facilitator.js');

const funders = { treasury: Keypair.generate(), solFunder: Keypair.generate() };
const ep = { key: 'probe', name: 'Probe', path: '/api/x' };

beforeEach(() => {
	mintWallet.mockReset();
	mintWallet.mockImplementation(async () => {
		const keypair = Keypair.generate();
		return { id: 1, pubkey: keypair.publicKey.toBase58(), ata: Keypair.generate().publicKey.toBase58(), keypair };
	});
	chain.fundWallets = vi.fn(async () => ({ ok: true, signature: 'fundsig' }));
	chain.usdc = { exists: true, atomic: 10_000_000n };
});

describe('per-call fresh payer headroom', () => {
	it('mints nothing when the fee wallet cannot fund a wallet above the sponsor floor', async () => {
		chain.sol = SPONSOR_SOL_FLOOR_LAMPORTS + 1_000;
		const payer = await createFreshCallPayer({ sql: async () => [], conn: {}, funders, runId: 'r', mintInfo: { decimals: 6 } });
		expect(await payer.buyerFor(ep, 1000)).toBeNull();
		expect(mintWallet).not.toHaveBeenCalled();
		expect(chain.fundWallets).not.toHaveBeenCalled();
		expect(payer.stats.noHeadroom).toBe(1);
	});

	it('mints nothing when the treasury cannot cover the call price', async () => {
		chain.sol = SPONSOR_SOL_FLOOR_LAMPORTS + 1_000_000_000;
		chain.usdc = { exists: true, atomic: 999n };
		const payer = await createFreshCallPayer({ sql: async () => [], conn: {}, funders, runId: 'r', mintInfo: { decimals: 6 } });
		expect(await payer.buyerFor(ep, 1000)).toBeNull();
		expect(mintWallet).not.toHaveBeenCalled();
		expect(payer.stats.noHeadroom).toBe(1);
	});

	it('mints nothing when a balance cannot be read', async () => {
		chain.sol = null;
		const payer = await createFreshCallPayer({ sql: async () => [], conn: {}, funders, runId: 'r', mintInfo: { decimals: 6 } });
		expect(await payer.buyerFor(ep, 1000)).toBeNull();
		expect(mintWallet).not.toHaveBeenCalled();
	});

	it('mints and funds when both funders have headroom', async () => {
		chain.sol = SPONSOR_SOL_FLOOR_LAMPORTS + 1_000_000_000;
		const payer = await createFreshCallPayer({ sql: async () => [], conn: {}, funders, runId: 'r', mintInfo: { decimals: 6 } });
		const kp = await payer.buyerFor(ep, 1000);
		expect(kp).toBeInstanceOf(Keypair);
		expect(mintWallet).toHaveBeenCalledTimes(1);
		expect(chain.fundWallets).toHaveBeenCalledTimes(1);
		expect(payer.stats.minted).toBe(1);
	});
});
