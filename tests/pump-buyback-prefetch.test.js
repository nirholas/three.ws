// Batched vault read for run-buyback (api/_lib/pump-buyback-prefetch.js).
//
// Production 2026-11-13: /api/cron/run-buyback spent 37,016 getTokenAccountBalance
// plus 8,274 getAccountInfo calls in 24h, while every one of its 2,333 runs that day
// ended "skipped" (empty vault) across 92 coins. Each coin cost one curve read and
// three vault reads, one at a time, to learn the vault was empty. The sweep now reads
// every curve and every buyback vault in getMultipleAccounts batches of 100.

import { describe, it, expect } from 'vitest';
import { PublicKey, Keypair } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { getBuybackAuthorityPDA } from '@three-ws/agent-payments';
import { SOLANA_USDC_MINT } from '../api/payments/_config.js';
import {
	prefetchBuybackState,
	decodeTokenAmount,
	PREFETCH_BATCH,
} from '../api/_lib/pump-buyback-prefetch.js';

const THREE = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

function tokenAccount(amount, owner = TOKEN_PROGRAM_ID) {
	const data = Buffer.alloc(165);
	data.writeBigUInt64LE(BigInt(amount), 64);
	return { data, owner, lamports: 2_039_280, executable: false };
}

function vaultAddress(mint, currency = SOLANA_USDC_MINT) {
	const [authority] = getBuybackAuthorityPDA(new PublicKey(mint));
	return getAssociatedTokenAddressSync(new PublicKey(currency), authority, true, TOKEN_PROGRAM_ID).toBase58();
}

/** A connection answering getMultipleAccountsInfo from a table keyed by address. */
function chainWith(accounts = {}, { failCall = -1 } = {}) {
	const calls = [];
	return {
		calls,
		async getMultipleAccountsInfo(keys) {
			calls.push(keys.length);
			if (calls.length - 1 === failCall) throw new Error('429 Too Many Requests');
			return keys.map((k) => accounts[k.toBase58()] ?? null);
		},
	};
}

const coin = (id, mint = THREE, extra = {}) => ({ id, mint, quote_mint: SOLANA_USDC_MINT, ...extra });

describe('decodeTokenAmount', () => {
	it('reads the u64 amount of an SPL token account', () => {
		expect(decodeTokenAmount(tokenAccount(123456789))).toBe(123456789n);
	});
	it('returns null for an account the token program does not own or a short buffer', () => {
		expect(decodeTokenAmount(tokenAccount(5, Keypair.generate().publicKey))).toBeNull();
		expect(decodeTokenAmount({ data: Buffer.alloc(10), owner: TOKEN_PROGRAM_ID })).toBeNull();
	});
});

describe('prefetchBuybackState', () => {
	it('reads curves and vaults in two batched calls, treating a missing vault as empty', async () => {
		const chain = chainWith();
		const out = await prefetchBuybackState({ connection: chain, network: 'mainnet', coins: [coin(1), coin(2)] });
		expect(chain.calls).toEqual([2, 2]);
		expect(out.get(1)).toMatchObject({ quote: { currencyStr: SOLANA_USDC_MINT, source: 'db' }, buyback: 0n });
		expect(out.get(2).buyback).toBe(0n);
	});

	it('reports a funded vault balance from the batch', async () => {
		const chain = chainWith({ [vaultAddress(THREE)]: tokenAccount(42_000) });
		const out = await prefetchBuybackState({ connection: chain, network: 'mainnet', coins: [coin(7)] });
		expect(out.get(7).buyback).toBe(42_000n);
	});

	it('chunks at the batch size', async () => {
		const coins = Array.from({ length: PREFETCH_BATCH + 5 }, (_, i) => coin(i + 1));
		const chain = chainWith();
		await prefetchBuybackState({ connection: chain, network: 'mainnet', coins });
		expect(chain.calls).toEqual([PREFETCH_BATCH, 5, PREFETCH_BATCH, 5]);
	});

	it('leaves coins out when their curve batch failed, so the sweep reads them one by one', async () => {
		const chain = chainWith({}, { failCall: 0 });
		const out = await prefetchBuybackState({ connection: chain, network: 'mainnet', coins: [coin(1)] });
		expect(out.has(1)).toBe(false);
	});

	it('marks the balance unknown (null) when only the vault batch failed', async () => {
		const chain = chainWith({}, { failCall: 1 });
		const out = await prefetchBuybackState({ connection: chain, network: 'mainnet', coins: [coin(1)] });
		expect(out.get(1)).toMatchObject({ quote: { currencyStr: SOLANA_USDC_MINT }, buyback: null });
	});

	it('falls back to USDC when neither the curve nor the database names a quote', async () => {
		const out = await prefetchBuybackState({
			connection: chainWith(),
			network: 'mainnet',
			coins: [coin(3, THREE, { quote_mint: null })],
		});
		expect(out.get(3).quote).toMatchObject({ currencyStr: SOLANA_USDC_MINT, source: 'fallback' });
	});

	it('makes no call for an empty sweep', async () => {
		const chain = chainWith();
		const out = await prefetchBuybackState({ connection: chain, network: 'mainnet', coins: [] });
		expect(out.size).toBe(0);
		expect(chain.calls).toEqual([]);
	});
});
