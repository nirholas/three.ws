// The deposit asset catalog and the two newer legs of the deposit verifier:
// USDC credited at the published fixed rate from the deposit wallet's token
// account delta, and the owner-configured $THREE bonus granted as a separate,
// idempotent ledger row. Every chain read is mocked at the RPC boundary; the
// credit call is captured so the test can assert on exactly what is booked.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const SINK = 'So11111111111111111111111111111111111111112';
const SIGNER = 'Vote111111111111111111111111111111111111111';
const USDC_MAINNET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const THREE_MINT = 'THREEsynthetic1111';
const SIG = '7'.repeat(88);

const chain = vi.hoisted(() => ({ tx: null }));
vi.mock('../api/_lib/solana/connection.js', () => ({
	solanaConnection: vi.fn(() => ({
		getParsedTransaction: vi.fn(async () => chain.tx),
		getSignatureStatuses: vi.fn(async () => ({ value: [null] })),
	})),
}));
vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings) => (strings.join('').includes('user_wallets') ? [{ address: SIGNER }] : [])),
}));
const ledger = vi.hoisted(() => ({ creditAccount: vi.fn(), balance: 0 }));
vi.mock('../api/_lib/credits.js', () => ({ creditAccount: ledger.creditAccount }));
vi.mock('../api/_lib/token/price.js', () => ({ getTokenPriceUsd: vi.fn(async () => ({ priceUsd: 0.002 })) }));
vi.mock('../api/_lib/balances.js', () => ({ solanaMintUsdPrice: vi.fn(async () => 150) }));
const policy = vi.hoisted(() => ({ bonusBps: 0 }));
vi.mock('../api/_lib/token/config.js', () => ({
	TOKEN_MINT: 'THREEsynthetic1111',
	TOKEN_DECIMALS: 6,
	TOKEN_SYMBOL: 'THREE',
	treasuryWalletOrNull: () => null,
	creditBonusBps: () => policy.bonusBps,
}));

const { verifyAndCreditDeposit, depositAssetCatalog, DEPOSIT_ASSETS } = await import('../api/_lib/credit-deposit.js');
const { USDC_CREDIT_RATE } = await import('../api/_lib/pricing/catalog.js');

function splTransfer({ mint, atomics }) {
	return {
		slot: 1,
		meta: {
			err: null,
			preTokenBalances: [{ accountIndex: 2, mint, owner: SINK, uiTokenAmount: { amount: '0' } }],
			postTokenBalances: [{ accountIndex: 2, mint, owner: SINK, uiTokenAmount: { amount: String(atomics) } }],
		},
		transaction: { message: { accountKeys: [{ pubkey: SIGNER, signer: true }, { pubkey: SINK, signer: false }] } },
	};
}

beforeEach(() => {
	process.env.NODE_ENV = 'test';
	process.env.CREDITS_DEPOSIT_WALLET_SOLANA = SINK;
	policy.bonusBps = 0;
	ledger.balance = 0;
	ledger.creditAccount.mockReset();
	ledger.creditAccount.mockImplementation(async ({ amountUsd }) => {
		ledger.balance = Math.round((ledger.balance + amountUsd) * 1e6) / 1e6;
		return { balanceUsd: ledger.balance, ledgerId: `l-${ledger.creditAccount.mock.calls.length}`, replay: false };
	});
});

describe('deposit asset catalog', () => {
	it('lists SOL, USDC and $THREE with the rate each is credited at, read from live config', () => {
		expect(DEPOSIT_ASSETS).toEqual(['SOL', 'USDC', 'THREE']);
		policy.bonusBps = 250;
		const catalog = depositAssetCatalog('mainnet');
		expect(catalog.map((a) => a.asset)).toEqual(['SOL', 'USDC', 'THREE']);
		expect(catalog[0]).toMatchObject({ native: true, decimals: 9, rate: { kind: 'live_price' }, bonus_bps: 0 });
		expect(catalog[1]).toMatchObject({ mint: USDC_MAINNET, decimals: 6, native: false, rate: { kind: 'fixed', usd_per_unit: USDC_CREDIT_RATE }, bonus_bps: 0 });
		expect(catalog[2]).toMatchObject({ mint: THREE_MINT, decimals: 6, native: false, rate: { kind: 'live_price' }, bonus_bps: 250 });
		expect(depositAssetCatalog('devnet')[1].mint).not.toBe(USDC_MAINNET);
	});
});

describe('USDC deposits', () => {
	it('credits the token-account delta at the fixed rate, with no bonus', async () => {
		chain.tx = splTransfer({ mint: USDC_MAINNET, atomics: 25_500_000 });
		const out = await verifyAndCreditDeposit({ user: { id: 'u1' }, asset: 'usdc', txSignature: SIG });
		expect(out).toMatchObject({ ok: true, replay: false, asset: 'USDC', amount: 25.5, price_usd: USDC_CREDIT_RATE, usd: 25.5, credited_usd: 25.5, bonus_usd: 0, bonus_bps: 0, balance_usd: 25.5 });
		expect(ledger.creditAccount).toHaveBeenCalledTimes(1);
		expect(ledger.creditAccount.mock.calls[0][0]).toMatchObject({
			userId: 'u1', amountUsd: 25.5, kind: 'deposit', refType: 'deposit_usdc', asset: 'USDC', assetAmount: 25_500_000n,
			priceUsd: USDC_CREDIT_RATE, idempotencyKey: `deposit:USDC:${SIG}`,
		});
	});

	it('refuses a transaction that moved no USDC to the deposit wallet', async () => {
		chain.tx = splTransfer({ mint: THREE_MINT, atomics: 1_000_000 });
		await expect(verifyAndCreditDeposit({ user: { id: 'u1' }, asset: 'USDC', txSignature: SIG })).rejects.toMatchObject({ status: 422, code: 'no_funds_received' });
		expect(ledger.creditAccount).not.toHaveBeenCalled();
	});

	it('rejects an asset outside the catalog before touching the chain', async () => {
		await expect(verifyAndCreditDeposit({ user: { id: 'u1' }, asset: 'BTC', txSignature: SIG })).rejects.toMatchObject({ status: 400, code: 'bad_request' });
	});
});

describe('the $THREE bonus', () => {
	it('grants the configured basis points as a separate grant row keyed to the deposit', async () => {
		policy.bonusBps = 500;
		chain.tx = splTransfer({ mint: THREE_MINT, atomics: 10_000_000_000 });
		const out = await verifyAndCreditDeposit({ user: { id: 'u1' }, asset: 'THREE', txSignature: SIG });
		expect(out).toMatchObject({ asset: 'THREE', amount: 10_000, price_usd: 0.002, usd: 20, credited_usd: 20, bonus_bps: 500, bonus_usd: 1, balance_usd: 21 });
		expect(ledger.creditAccount).toHaveBeenCalledTimes(2);
		expect(ledger.creditAccount.mock.calls[0][0]).toMatchObject({ kind: 'deposit', refType: 'deposit_three', amountUsd: 20, idempotencyKey: `deposit:THREE:${SIG}` });
		expect(ledger.creditAccount.mock.calls[1][0]).toMatchObject({
			kind: 'grant', action: 'deposit.three_bonus', refType: 'deposit_three_bonus', refId: SIG, amountUsd: 1, assetAmount: 0n,
			idempotencyKey: `deposit:THREE:${SIG}:bonus`, meta: { bonus_bps: 500, base_usd: 20 },
		});
	});

	it('grants nothing when the policy is unset, and only for $THREE', async () => {
		chain.tx = splTransfer({ mint: THREE_MINT, atomics: 10_000_000_000 });
		const out = await verifyAndCreditDeposit({ user: { id: 'u1' }, asset: 'THREE', txSignature: SIG });
		expect(out).toMatchObject({ credited_usd: 20, bonus_usd: 0, bonus_bps: 0 });
		expect(ledger.creditAccount).toHaveBeenCalledTimes(1);

		policy.bonusBps = 500;
		ledger.creditAccount.mockClear();
		chain.tx = splTransfer({ mint: USDC_MAINNET, atomics: 5_000_000 });
		const usdc = await verifyAndCreditDeposit({ user: { id: 'u1' }, asset: 'USDC', txSignature: SIG });
		expect(usdc).toMatchObject({ credited_usd: 5, bonus_usd: 0, bonus_bps: 0 });
		expect(ledger.creditAccount).toHaveBeenCalledTimes(1);
	});

	it('replays with the deposit: a re-verified signature credits and grants nothing twice', async () => {
		policy.bonusBps = 500;
		chain.tx = splTransfer({ mint: THREE_MINT, atomics: 10_000_000_000 });
		ledger.creditAccount.mockImplementation(async () => ({ balanceUsd: 21, ledgerId: 'l-old', replay: true }));
		const out = await verifyAndCreditDeposit({ user: { id: 'u1' }, asset: 'THREE', txSignature: SIG });
		expect(out).toMatchObject({ ok: true, replay: true, credited_usd: 0, bonus_usd: 0, bonus_bps: 500, balance_usd: 21 });
		expect(ledger.creditAccount.mock.calls.map((c) => c[0].idempotencyKey)).toEqual([`deposit:THREE:${SIG}`, `deposit:THREE:${SIG}:bonus`]);
	});
});
