// Browser-signed SPL payments must be built on the mint's own token program.
//
// $THREE (FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump) is a Token-2022 mint. The
// marketplace and skill-purchase fallback (the transaction the buyer signs when
// the platform cannot sponsor the fee) derived both ATAs and the transfer with
// @solana/spl-token's classic default, so a $THREE-priced skill named a source
// account the buyer does not hold, sent the transfer to a program that does not
// own the mint, and failed in the wallet's simulation. Every leg must be a
// TransferChecked on the mint's program with the mint's on-chain decimals, the
// recipient ATAs created idempotently on that program, and the Solana Pay
// reference riding the final instruction.

import { describe, it, expect } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import * as web3 from '@solana/web3.js';
import * as spl from '@solana/spl-token';
import {
	ASSOCIATED_TOKEN_PROGRAM_ID,
	MintLayout,
	MINT_SIZE,
	TOKEN_PROGRAM_ID,
	TOKEN_2022_PROGRAM_ID,
	TokenInstruction,
	getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import {
	buildReferencedSplTransfer,
	resolveMintInfo,
	splPaymentInstructions,
} from '../src/shared/spl-token-program.js';

const THREE_MINT = new PublicKey('FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump');
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

function mintData(decimals) {
	const data = Buffer.alloc(MINT_SIZE);
	MintLayout.encode(
		{
			mintAuthorityOption: 0,
			mintAuthority: PublicKey.default,
			supply: 0n,
			decimals,
			isInitialized: true,
			freezeAuthorityOption: 0,
			freezeAuthority: PublicKey.default,
		},
		data,
	);
	return data;
}

// The connection answers only the two reads the builders make: the mint account
// (owner program plus decimals in the real mint layout) and a blockhash.
function connectionFor(mints) {
	return {
		async getAccountInfo(key) {
			const m = mints.get(key.toBase58());
			return m ? { owner: m.program, data: mintData(m.decimals), lamports: 1, executable: false } : null;
		},
		async getLatestBlockhash() {
			return { blockhash: PublicKey.default.toBase58(), lastValidBlockHeight: 1 };
		},
	};
}

const SYNTHETIC_2022 = Keypair.generate().publicKey;
const MISSING = Keypair.generate().publicKey;
const conn = connectionFor(
	new Map([
		[THREE_MINT.toBase58(), { program: TOKEN_2022_PROGRAM_ID, decimals: 6 }],
		[USDC_MINT.toBase58(), { program: TOKEN_PROGRAM_ID, decimals: 6 }],
		[SYNTHETIC_2022.toBase58(), { program: TOKEN_2022_PROGRAM_ID, decimals: 9 }],
	]),
);

const buyer = Keypair.generate().publicKey;
const seller = Keypair.generate().publicKey;
const treasury = Keypair.generate().publicKey;
const reference = Keypair.generate().publicKey;

const transfers = (tx) => tx.instructions.filter((ix) => !ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID));
const creates = (tx) => tx.instructions.filter((ix) => ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID));

describe('buildReferencedSplTransfer', () => {
	it('builds a $THREE purchase on Token-2022 with TransferChecked legs and the reference last', async () => {
		const ata = (owner) => getAssociatedTokenAddressSync(THREE_MINT, owner, true, TOKEN_2022_PROGRAM_ID);
		const tx = await buildReferencedSplTransfer({
			connection: conn,
			web3,
			spl,
			payer: buyer,
			recipient: seller.toBase58(),
			mint: THREE_MINT.toBase58(),
			amount: 8_000_000n,
			reference: reference.toBase58(),
			fee: { recipient: treasury.toBase58(), amount: 2_000_000n },
		});

		const [feeLeg, sellerLeg] = transfers(tx);
		for (const leg of [feeLeg, sellerLeg]) {
			expect(leg.programId.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
			expect(leg.data[0]).toBe(TokenInstruction.TransferChecked);
			expect(leg.keys[0].pubkey.equals(ata(buyer))).toBe(true);
			expect(leg.keys[1].pubkey.equals(THREE_MINT)).toBe(true);
			expect(leg.data[9]).toBe(6);
		}
		expect(feeLeg.keys[2].pubkey.equals(ata(treasury))).toBe(true);
		expect(feeLeg.data.readBigUInt64LE(1)).toBe(2_000_000n);
		expect(sellerLeg.keys[2].pubkey.equals(ata(seller))).toBe(true);
		expect(sellerLeg.data.readBigUInt64LE(1)).toBe(8_000_000n);

		for (const create of creates(tx)) expect(create.keys[5].pubkey.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
		expect(creates(tx).map((c) => c.keys[1].pubkey.toBase58())).toEqual([ata(treasury), ata(seller)].map(String));

		const last = tx.instructions.at(-1);
		expect(last).toBe(sellerLeg);
		expect(last.keys.at(-1)).toEqual({ pubkey: reference, isSigner: false, isWritable: false });
		expect(tx.feePayer.equals(buyer)).toBe(true);
	});

	it('keeps a USDC purchase on the classic program', async () => {
		const ata = (owner) => getAssociatedTokenAddressSync(USDC_MINT, owner, true, TOKEN_PROGRAM_ID);
		const tx = await buildReferencedSplTransfer({
			connection: conn,
			web3,
			spl,
			payer: buyer,
			recipient: seller.toBase58(),
			mint: USDC_MINT.toBase58(),
			amount: 1_000_000n,
			reference: reference.toBase58(),
		});
		const [sellerLeg] = transfers(tx);
		expect(transfers(tx)).toHaveLength(1);
		expect(sellerLeg.programId.equals(TOKEN_PROGRAM_ID)).toBe(true);
		expect(sellerLeg.keys[0].pubkey.equals(ata(buyer))).toBe(true);
		expect(sellerLeg.keys[2].pubkey.equals(ata(seller))).toBe(true);
		expect(sellerLeg.keys.at(-1).pubkey.equals(reference)).toBe(true);
	});
});

describe('splPaymentInstructions', () => {
	it('uses the decimals the mint reports on chain', async () => {
		const { instructions, decimals } = await splPaymentInstructions({
			connection: conn,
			spl,
			mint: SYNTHETIC_2022,
			payer: buyer,
			legs: [{ owner: seller, atomics: 5n }],
		});
		expect(decimals).toBe(9);
		expect(instructions.at(-1).data[9]).toBe(9);
	});

	it('skips the create for a leg that asks for none and accepts an off-curve owner', async () => {
		const [pda] = PublicKey.findProgramAddressSync([Buffer.from('vault')], TOKEN_2022_PROGRAM_ID);
		const { instructions } = await splPaymentInstructions({
			connection: conn,
			spl,
			mint: THREE_MINT,
			payer: buyer,
			legs: [{ owner: pda, atomics: 1n, createAccount: false }],
		});
		expect(instructions).toHaveLength(1);
		expect(instructions[0].keys[2].pubkey.equals(
			getAssociatedTokenAddressSync(THREE_MINT, pda, true, TOKEN_2022_PROGRAM_ID),
		)).toBe(true);
	});

	it('refuses a mint that does not exist instead of guessing a program', async () => {
		await expect(resolveMintInfo(conn, MISSING, spl)).rejects.toThrow(/not found/i);
	});
});
