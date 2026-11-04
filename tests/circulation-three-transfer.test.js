// The circulation engine's $THREE payment (agent buys a skill from another
// agent) must be built on the mint's own token program, and its reference-bound
// creator leg must be the LAST instruction.
//
// $THREE (FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump) is a Token-2022 mint.
// The builder used to derive every ATA and transferChecked with the default
// (legacy) SPL Token program, so the source ATA it named does not exist for any
// $THREE holder and the transaction failed. It also appended the platform-fee
// leg after the creator leg, while confirmSkillPurchase hands the payment to
// @solana/pay validateTransfer, which reads only the final instruction for the
// transfer and its reference: every fee-split purchase would have been marked a
// mismatch even had it landed.

import { describe, it, expect } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import {
	ASSOCIATED_TOKEN_PROGRAM_ID,
	TOKEN_2022_PROGRAM_ID,
	getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { buildThreeTransferInstructions } from '../api/_lib/circulation.js';

const THREE_MINT = new PublicKey('FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump');
const buyer = Keypair.generate().publicKey;
const seller = Keypair.generate().publicKey;
const treasury = Keypair.generate().publicKey;
const reference = Keypair.generate().publicKey;
const ata2022 = (owner) => getAssociatedTokenAddressSync(THREE_MINT, owner, true, TOKEN_2022_PROGRAM_ID);

function build(feeLeg = null) {
	return buildThreeTransferInstructions({
		mint: THREE_MINT,
		tokenProgram: TOKEN_2022_PROGRAM_ID,
		decimals: 6,
		from: buyer,
		to: seller.toBase58(),
		atomic: 900_000n,
		referenceKey: reference,
		feeLeg,
	});
}

const transfers = (ixs) => ixs.filter((ix) => !ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID));

describe('buildThreeTransferInstructions', () => {
	it('builds every transfer on Token-2022 between the Token-2022 ATAs', () => {
		const ixs = build({ wallet: treasury.toBase58(), atomics: 100_000n });
		for (const ix of transfers(ixs)) {
			expect(ix.programId.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
			expect(ix.keys[0].pubkey.equals(ata2022(buyer))).toBe(true);
		}
		const destinations = transfers(ixs).map((ix) => ix.keys[2].pubkey.toBase58());
		expect(destinations.sort()).toEqual([ata2022(seller), ata2022(treasury)].map(String).sort());
	});

	it('opens the seller and treasury ATAs on Token-2022', () => {
		const creates = build({ wallet: treasury.toBase58(), atomics: 100_000n }).filter((ix) =>
			ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID),
		);
		expect(creates).toHaveLength(2);
		for (const ix of creates) expect(ix.keys[5].pubkey.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
		expect(creates.map((ix) => ix.keys[1].pubkey.toBase58()).sort()).toEqual(
			[ata2022(seller), ata2022(treasury)].map(String).sort(),
		);
	});

	it('puts the reference-bound creator leg last when a platform fee is split off', () => {
		const ixs = build({ wallet: treasury.toBase58(), atomics: 100_000n });
		const last = ixs.at(-1);
		expect(last.keys[2].pubkey.equals(ata2022(seller))).toBe(true);
		expect(last.keys.at(-1).pubkey.equals(reference)).toBe(true);
		const fee = transfers(ixs).find((ix) => ix.keys[2].pubkey.equals(ata2022(treasury)));
		expect(fee.keys.some((k) => k.pubkey.equals(reference))).toBe(false);
	});

	it('builds a plain transfer with the reference on the only transfer', () => {
		const ixs = build();
		expect(transfers(ixs)).toHaveLength(1);
		expect(ixs.at(-1).keys.at(-1).pubkey.equals(reference)).toBe(true);
	});
});
