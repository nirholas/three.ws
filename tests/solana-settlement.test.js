import { describe, it, expect, vi } from 'vitest';

const getTransactionMock = vi.fn();

vi.mock('../api/_lib/solana/connection.js', () => ({
	solanaConnection: () => ({ getTransaction: (...a) => getTransactionMock(...a) }),
}));

const {
	parseSettlement,
	tokenBalanceDeltas,
	mintSymbol,
	resolveSettlement,
	SettlementResolveError,
} = await import('../api/_lib/x402/solana-settlement.js');

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const SYNTH_MINT = 'THREEsynthetic1111111111111111111111111111';
const PAYER = 'PAYERsynthetic111111111111111111111111111';
const PAYEE = 'PAYEEsynthetic111111111111111111111111111';
const SIG = 'SYNTHETICsig1111111111111111111111111111111111111111111111111111111111111';

function balance(owner, mint, amount, decimals = 6) {
	return { owner, mint, uiTokenAmount: { amount: String(amount), decimals, uiAmount: Number(amount) / 10 ** decimals } };
}

function tx({ pre, post, err = null, fee = 5000, slot = 12345, blockTime = 1_700_000_000 }) {
	return { meta: { err, fee, preTokenBalances: pre, postTokenBalances: post }, slot, blockTime };
}

describe('tokenBalanceDeltas', () => {
	it('computes one delta per owner+mint from pre/post balances', () => {
		const deltas = tokenBalanceDeltas({
			preTokenBalances: [balance(PAYER, USDC_MINT, 5_000_000), balance(PAYEE, USDC_MINT, 0)],
			postTokenBalances: [balance(PAYER, USDC_MINT, 4_000_000), balance(PAYEE, USDC_MINT, 1_000_000)],
		});
		const byOwner = Object.fromEntries(deltas.map((d) => [d.owner, d.deltaAtomics]));
		expect(byOwner[PAYER]).toBe(-1_000_000n);
		expect(byOwner[PAYEE]).toBe(1_000_000n);
	});

	it('sums multiple token accounts for the same owner and mint', () => {
		const deltas = tokenBalanceDeltas({
			preTokenBalances: [balance(PAYER, USDC_MINT, 2_000_000), balance(PAYER, USDC_MINT, 3_000_000)],
			postTokenBalances: [balance(PAYER, USDC_MINT, 1_000_000), balance(PAYER, USDC_MINT, 3_000_000)],
		});
		expect(deltas).toHaveLength(1);
		expect(deltas[0].deltaAtomics).toBe(-1_000_000n);
	});

	it('drops owners whose net delta is zero', () => {
		const deltas = tokenBalanceDeltas({
			preTokenBalances: [balance(PAYER, USDC_MINT, 1_000_000)],
			postTokenBalances: [balance(PAYER, USDC_MINT, 1_000_000)],
		});
		expect(deltas).toHaveLength(0);
	});
});

describe('mintSymbol', () => {
	it('recognises USDC and $THREE', () => {
		expect(mintSymbol(USDC_MINT)).toBe('USDC');
		expect(mintSymbol(THREE_MINT)).toBe('THREE');
	});

	it('returns null for an unrecognised mint', () => {
		expect(mintSymbol(SYNTH_MINT)).toBeNull();
	});
});

describe('parseSettlement', () => {
	it('resolves payer, payee, mint, amount, fee, slot and time from a plain USDC settlement', () => {
		const result = parseSettlement(
			tx({
				pre: [balance(PAYER, USDC_MINT, 5_000_000), balance(PAYEE, USDC_MINT, 0)],
				post: [balance(PAYER, USDC_MINT, 4_000_000), balance(PAYEE, USDC_MINT, 1_000_000)],
			}),
			{ signature: SIG },
		);
		expect(result).toEqual({
			signature: SIG,
			network: 'solana',
			payer: PAYER,
			payee: PAYEE,
			mint: USDC_MINT,
			symbol: 'USDC',
			amountAtomics: '1000000',
			decimals: 6,
			feeLamports: 5000,
			slot: 12345,
			blockTime: 1_700_000_000,
		});
	});

	it('picks the expected settlement mint (USDC) when a second, unrelated mint also moves', () => {
		// A swap-funded payment, or any transaction that bundles an incidental
		// transfer, can move a second SPL mint in the same signature. There is no
		// price oracle here to compare an arbitrary mint's value against USDC's
		// (raw atomics and UI-scaled amount are both just unit counts, not value),
		// so the resolver asks for the settlement mint it expects (USDC by
		// default) rather than guessing by magnitude.
		const result = parseSettlement(
			tx({
				pre: [
					balance(PAYER, USDC_MINT, 5_000_000),
					balance(PAYEE, USDC_MINT, 0),
					balance(PAYER, SYNTH_MINT, 1_000_000_000, 9),
					balance(PAYEE, SYNTH_MINT, 0, 9),
				],
				post: [
					balance(PAYER, USDC_MINT, 4_000_000),
					balance(PAYEE, USDC_MINT, 1_000_000),
					balance(PAYER, SYNTH_MINT, 950_000_000, 9),
					balance(PAYEE, SYNTH_MINT, 50_000_000, 9),
				],
			}),
			{ signature: SIG },
		);
		expect(result.mint).toBe(USDC_MINT);
		expect(result.amountAtomics).toBe('1000000');
	});

	it('falls back to the one mint that moved when it is not the expected mint', () => {
		const result = parseSettlement(
			tx({
				pre: [balance(PAYER, SYNTH_MINT, 1_000_000_000, 9), balance(PAYEE, SYNTH_MINT, 0, 9)],
				post: [balance(PAYER, SYNTH_MINT, 950_000_000, 9), balance(PAYEE, SYNTH_MINT, 50_000_000, 9)],
			}),
			{ signature: SIG },
		);
		expect(result.mint).toBe(SYNTH_MINT);
		expect(result.amountAtomics).toBe('50000000');
	});

	it('throws when several non-expected mints moved and none matches the expected mint', () => {
		const SYNTH_MINT_2 = 'OTHERsynthetic1111111111111111111111111111';
		try {
			parseSettlement(
				tx({
					pre: [
						balance(PAYER, SYNTH_MINT, 1_000_000_000, 9),
						balance(PAYEE, SYNTH_MINT, 0, 9),
						balance(PAYER, SYNTH_MINT_2, 1_000_000_000, 9),
						balance(PAYEE, SYNTH_MINT_2, 0, 9),
					],
					post: [
						balance(PAYER, SYNTH_MINT, 950_000_000, 9),
						balance(PAYEE, SYNTH_MINT, 50_000_000, 9),
						balance(PAYER, SYNTH_MINT_2, 900_000_000, 9),
						balance(PAYEE, SYNTH_MINT_2, 100_000_000, 9),
					],
				}),
				{ signature: SIG },
			);
			throw new Error('expected a throw');
		} catch (e) {
			expect(e.code).toBe('no_token_transfer');
		}
	});

	it('resolves a non-USDC mint explicitly when the caller names it', () => {
		const result = parseSettlement(
			tx({
				pre: [balance(PAYER, THREE_MINT, 1_000_000_000, 6), balance(PAYEE, THREE_MINT, 0, 6)],
				post: [balance(PAYER, THREE_MINT, 900_000_000, 6), balance(PAYEE, THREE_MINT, 100_000_000, 6)],
			}),
			{ signature: SIG, mint: THREE_MINT },
		);
		expect(result.mint).toBe(THREE_MINT);
		expect(result.symbol).toBe('THREE');
		expect(result.amountAtomics).toBe('100000000');
	});

	it('resolves a three-owner settlement shape (a USDC transfer alongside an unrelated fee-collector balance and a second mint)', () => {
		// Mirrors the real-world shape a facilitator-routed x402 settlement can
		// take: a fee collector's own USDC balance sits in the same transaction
		// without itself being the payer or payee, and an unrelated SPL mint
		// (e.g. a swap leftover) moves between the same two owners. The resolver
		// must still single out the USDC payer/payee pair. Synthetic accounts
		// throughout (per CLAUDE.md: no real third-party mint, wallet, or handle
		// in committed fixtures); verified separately against a live mainnet
		// signature via resolveSettlement() during manual QA, not committed here.
		const FEE_COLLECTOR = 'FEEsynthetic1111111111111111111111111111111';
		const MERCHANT = 'MERCHANTsynthetic111111111111111111111111111';
		const CUSTOMER = 'CUSTOMERsynthetic111111111111111111111111111';
		const OTHER_MINT = 'OTHERsynthetic22222222222222222222222222222';
		const result = parseSettlement(
			{
				meta: {
					err: null,
					fee: 5000,
					preTokenBalances: [
						balance(FEE_COLLECTOR, USDC_MINT, 33_586_654_975),
						balance(MERCHANT, OTHER_MINT, 12_576_312_270_994, 9),
						balance(MERCHANT, USDC_MINT, 73_251_888_166),
						balance(CUSTOMER, USDC_MINT, 5_394_299_230),
						balance(CUSTOMER, OTHER_MINT, 1_863_488_431_869, 9),
					],
					postTokenBalances: [
						balance(FEE_COLLECTOR, USDC_MINT, 33_586_654_975),
						balance(MERCHANT, OTHER_MINT, 12_575_617_189_732, 9),
						balance(MERCHANT, USDC_MINT, 73_256_888_166),
						balance(CUSTOMER, USDC_MINT, 5_389_297_900),
						balance(CUSTOMER, OTHER_MINT, 1_864_183_513_131, 9),
					],
				},
				slot: 457148215,
				blockTime: 1792048039,
			},
			{ signature: SIG },
		);
		expect(result.mint).toBe(USDC_MINT);
		expect(result.payer).toBe(CUSTOMER);
		expect(result.payee).toBe(MERCHANT);
		expect(result.amountAtomics).toBe('5000000');
		expect(result.symbol).toBe('USDC');
		expect(result.slot).toBe(457148215);
		expect(result.blockTime).toBe(1792048039);
	});

	it('throws tx_failed for a transaction that failed on-chain', () => {
		expect(() => parseSettlement(tx({ pre: [], post: [], err: { InstructionError: [0, 'Custom'] } }), { signature: SIG })).toThrow(
			SettlementResolveError,
		);
		try {
			parseSettlement(tx({ pre: [], post: [], err: {} }), { signature: SIG });
		} catch (e) {
			expect(e.code).toBe('tx_failed');
		}
	});

	it('throws tx_not_found for a null transaction', () => {
		try {
			parseSettlement(null, { signature: SIG });
			throw new Error('expected a throw');
		} catch (e) {
			expect(e.code).toBe('tx_not_found');
		}
	});

	it('throws no_token_transfer when nothing moved', () => {
		try {
			parseSettlement(tx({ pre: [], post: [] }), { signature: SIG });
			throw new Error('expected a throw');
		} catch (e) {
			expect(e.code).toBe('no_token_transfer');
		}
	});

	it('throws no_token_transfer when balances changed but no owner both sent and received', () => {
		// Only one side moves (e.g. an airdrop-style mint with no counterparty debit).
		try {
			parseSettlement(
				tx({ pre: [balance(PAYEE, USDC_MINT, 0)], post: [balance(PAYEE, USDC_MINT, 1_000_000)] }),
				{ signature: SIG },
			);
			throw new Error('expected a throw');
		} catch (e) {
			expect(e.code).toBe('no_token_transfer');
		}
	});
});

describe('resolveSettlement', () => {
	it('fetches the transaction and parses it', async () => {
		getTransactionMock.mockResolvedValueOnce(
			tx({
				pre: [balance(PAYER, USDC_MINT, 5_000_000), balance(PAYEE, USDC_MINT, 0)],
				post: [balance(PAYER, USDC_MINT, 4_000_000), balance(PAYEE, USDC_MINT, 1_000_000)],
			}),
		);
		const result = await resolveSettlement(SIG);
		expect(getTransactionMock).toHaveBeenCalledWith(SIG, { commitment: 'confirmed', maxSupportedTransactionVersion: 1 });
		expect(result.payer).toBe(PAYER);
		expect(result.payee).toBe(PAYEE);
		expect(result.amountAtomics).toBe('1000000');
	});
});
