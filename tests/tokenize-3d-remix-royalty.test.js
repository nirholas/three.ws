// Remix-royalty settlement on a tokenized-3D mint (Prompt 08, task 4) — when a
// mint names a parent_mint, its fee is split with the parent creator using the
// SAME pure math as the forge_creations remix bazaar (api/_lib/remix-royalty.js).
// This exercises settleTokenizeRemixRoyalty's every honestly-reported outcome
// with an injected fake `sql` (no real DB) and the real (unconfigured-in-CI)
// payout-wallet resolver — no network calls, no mocked "fake success".

import { describe, it, expect } from 'vitest';

import { settleTokenizeRemixRoyalty } from '../api/_lib/tokenize-3d.js';
import { REMIX_MIN_PAYOUT_ATOMICS } from '../api/_lib/remix-royalty.js';

const PARENT_MINT = 'ParentMint1111111111111111111111111111111111';
const CREATOR_WALLET = 'So11111111111111111111111111111111111111112';
const MINT_FEE_ATOMICS = 250_000n; // $0.25, matches priceFor('mint_3d_asset')

function fakeSqlReturning(row) {
	return async () => (row ? [row] : []);
}

describe('settleTokenizeRemixRoyalty', () => {
	it('never settles on devnet — the payout wallet only holds real mainnet funds', async () => {
		const result = await settleTokenizeRemixRoyalty({
			sql: fakeSqlReturning({ mint: PARENT_MINT, royalty_bps: 1000, royalty_recipient: CREATOR_WALLET }),
			parentMint: PARENT_MINT,
			network: 'devnet',
			feeAtomics: MINT_FEE_ATOMICS,
		});
		expect(result.paid).toBe(false);
		expect(result.reason).toBe('devnet_not_settled');
	});

	it('never settles when this call collected no fee (OAuth bypass) — nothing to split', async () => {
		const result = await settleTokenizeRemixRoyalty({
			sql: fakeSqlReturning({ mint: PARENT_MINT, royalty_bps: 1000, royalty_recipient: CREATOR_WALLET }),
			parentMint: PARENT_MINT,
			network: 'mainnet',
			feeAtomics: 0n,
		});
		expect(result.paid).toBe(false);
		expect(result.reason).toBe('no_fee_collected');
	});

	it('reports parent_not_found when the named parent_mint has no minted row', async () => {
		const result = await settleTokenizeRemixRoyalty({
			sql: fakeSqlReturning(null),
			parentMint: 'NoSuchMint11111111111111111111111111111111',
			network: 'mainnet',
			feeAtomics: MINT_FEE_ATOMICS,
		});
		expect(result.paid).toBe(false);
		expect(result.reason).toBe('parent_not_found');
	});

	it('reports no_creator_wallet when the parent has neither a royalty_recipient nor an owner_wallet', async () => {
		const result = await settleTokenizeRemixRoyalty({
			sql: fakeSqlReturning({ mint: PARENT_MINT, royalty_bps: 1000, royalty_recipient: null, owner_wallet: null }),
			parentMint: PARENT_MINT,
			network: 'mainnet',
			feeAtomics: MINT_FEE_ATOMICS,
		});
		expect(result.paid).toBe(false);
		expect(result.reason).toBe('no_creator_wallet');
	});

	it('computes the real split and — with no platform payout wallet configured in this env — reports payout_unconfigured honestly (never a fabricated payout)', async () => {
		expect(process.env.REMIX_ROYALTY_PAYOUT_KEY).toBeFalsy();
		expect(process.env.CLUB_SOLANA_TREASURY_SECRET_KEY_B64).toBeFalsy();

		const result = await settleTokenizeRemixRoyalty({
			sql: fakeSqlReturning({ mint: PARENT_MINT, royalty_bps: 1000, royalty_recipient: CREATOR_WALLET }),
			parentMint: PARENT_MINT,
			network: 'mainnet',
			feeAtomics: MINT_FEE_ATOMICS,
		});
		// 10% of 250_000 atomics = 25_000 atomics — well above the dust floor, so
		// the ONLY reason this doesn't pay is the missing payout wallet.
		expect(BigInt(result.creator_atomics)).toBe((MINT_FEE_ATOMICS * 1000n) / 10000n);
		expect(result.royalty_bps).toBe(1000);
		expect(result.paid).toBe(false);
		expect(result.reason).toBe('payout_unconfigured');
	});

	it('drops a sub-dust royalty rather than pretending to pay it', async () => {
		// A tiny fee at a low bps produces a creator slice below the dust floor.
		const tinyFee = 1000n; // $0.001
		const result = await settleTokenizeRemixRoyalty({
			sql: fakeSqlReturning({ mint: PARENT_MINT, royalty_bps: 100, royalty_recipient: CREATOR_WALLET }), // 1%
			parentMint: PARENT_MINT,
			network: 'mainnet',
			feeAtomics: tinyFee,
		});
		expect((tinyFee * 100n) / 10000n).toBeLessThan(REMIX_MIN_PAYOUT_ATOMICS);
		expect(result.paid).toBe(false);
		expect(result.reason).toBe('below_dust_floor');
	});

	it('clamps a royalty rate above the cap and reports it', async () => {
		const result = await settleTokenizeRemixRoyalty({
			sql: fakeSqlReturning({ mint: PARENT_MINT, royalty_bps: 9999, royalty_recipient: CREATOR_WALLET }),
			parentMint: PARENT_MINT,
			network: 'mainnet',
			feeAtomics: MINT_FEE_ATOMICS,
		});
		expect(result.capped).toBe(true);
		expect(result.royalty_bps).toBeLessThan(9999);
	});
});

describe('settleOrDeferRemixRoyalty', () => {
	it('pays nothing until the registered post-settlement work runs', async () => {
		const { settleOrDeferRemixRoyalty } = await import('../api/_lib/tokenize-3d.js');
		const updates = [];
		const sql = async (strings, ...values) => {
			const text = strings.join('?');
			if (text.includes('update tokenized_3d_assets')) updates.push(values);
			return [{ mint: PARENT_MINT, royalty_bps: 1000, royalty_recipient: CREATOR_WALLET }];
		};
		const queued = [];
		const pending = await settleOrDeferRemixRoyalty({
			sql, rowId: 'row-1', parentMint: PARENT_MINT, network: 'devnet', feeAtomics: MINT_FEE_ATOMICS,
			defer: (run) => queued.push(run),
		});
		expect(pending).toMatchObject({ paid: false, reason: 'pending_payment_settlement' });
		expect(queued).toHaveLength(1);
		expect(updates).toHaveLength(0);
		await queued[0]();
		expect(updates).toHaveLength(1);
		expect(JSON.parse(updates[0][0]).reason).toBe('devnet_not_settled');
	});

	it('settles immediately when there is nothing to wait for', async () => {
		const { settleOrDeferRemixRoyalty } = await import('../api/_lib/tokenize-3d.js');
		const out = await settleOrDeferRemixRoyalty({
			sql: fakeSqlReturning(null), rowId: 'row-2', parentMint: PARENT_MINT, network: 'devnet', feeAtomics: 0n,
		});
		expect(out.reason).toBe('devnet_not_settled');
	});
});
