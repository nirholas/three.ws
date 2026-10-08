// Credit deposits verify on mainnet in production, whatever the client asks for.
//
// Credits are priced at the mainnet SOL / $THREE price and spend as real USDC
// through /api/pay/execute. Honouring `network: 'devnet'` let a faucet-funded
// devnet transfer to the deposit address mint real spendable credits.

import { describe, it, expect, vi, afterEach } from 'vitest';

const urls = [];
vi.mock('../api/_lib/solana/connection.js', () => ({
	solanaConnection: vi.fn(({ url }) => {
		urls.push(url);
		return { getParsedTransaction: vi.fn(async () => null) };
	}),
}));
vi.mock('../api/_lib/db.js', () => ({ sql: vi.fn(async () => []) }));
vi.mock('../api/_lib/credits.js', () => ({ creditAccount: vi.fn() }));
vi.mock('../api/_lib/token/price.js', () => ({ getTokenPriceUsd: vi.fn() }));
vi.mock('../api/_lib/balances.js', () => ({ solanaMintUsdPrice: vi.fn() }));
vi.mock('../api/_lib/token/config.js', () => ({ TOKEN_MINT: 'THREEsynthetic1111', TOKEN_DECIMALS: 6, treasuryWalletOrNull: () => null }));

const { verifyAndCreditDeposit } = await import('../api/_lib/credit-deposit.js');

const SIG = '5'.repeat(88);
const ORIGINAL_ENV = process.env.NODE_ENV;

afterEach(() => {
	process.env.NODE_ENV = ORIGINAL_ENV;
	delete process.env.CREDITS_DEPOSIT_WALLET_SOLANA;
	urls.length = 0;
});

describe('credit deposit network', () => {
	it('ignores a devnet request in production and reads mainnet', async () => {
		process.env.NODE_ENV = 'production';
		process.env.CREDITS_DEPOSIT_WALLET_SOLANA = 'So11111111111111111111111111111111111111112';
		await verifyAndCreditDeposit({ user: { id: 'u1' }, asset: 'SOL', txSignature: SIG, network: 'devnet' }).catch(() => {});
		expect(urls.length).toBeGreaterThan(0);
		expect(urls.every((u) => !/devnet/.test(u))).toBe(true);
	});

	it('still allows devnet outside production for local testing', async () => {
		process.env.NODE_ENV = 'test';
		process.env.CREDITS_DEPOSIT_WALLET_SOLANA = 'So11111111111111111111111111111111111111112';
		await verifyAndCreditDeposit({ user: { id: 'u1' }, asset: 'SOL', txSignature: SIG, network: 'devnet' }).catch(() => {});
		expect(urls.some((u) => /devnet/.test(u))).toBe(true);
	});
});
