// An agent buying an asset from its own custodial wallet pays in the listing's
// currency mint, and that mint may be $THREE
// (FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump), a Token-2022 mint. The
// purchase used to derive both ATAs and the transferChecked with the default
// classic SPL Token program, so a $THREE-priced purchase named a source account
// the agent does not own and failed on-chain. USDC stays on the classic program.

import { describe, it, expect } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import {
	ASSOCIATED_TOKEN_PROGRAM_ID,
	TOKEN_PROGRAM_ID,
	TOKEN_2022_PROGRAM_ID,
	getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { buildAgentPurchaseInstructions } from '../api/_lib/agent-purchase.js';

const THREE_MINT = new PublicKey('FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump');
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

function build(mint, tokenProgram) {
	const buyer = Keypair.generate().publicKey;
	const seller = Keypair.generate().publicKey;
	const reference = Keypair.generate().publicKey;
	const ixs = buildAgentPurchaseInstructions({
		buyer,
		mint,
		tokenProgram,
		recipient: seller.toBase58(),
		amountAtomics: '2500000',
		decimals: 6,
		referenceKey: reference,
	});
	const ata = (owner) => getAssociatedTokenAddressSync(mint, owner, true, tokenProgram);
	return { ixs, buyer, seller, reference, ata };
}

describe('buildAgentPurchaseInstructions', () => {
	it('pays a $THREE price between Token-2022 ATAs on the Token-2022 program', () => {
		const { ixs, buyer, seller, reference, ata } = build(THREE_MINT, TOKEN_2022_PROGRAM_ID);
		const [create, transfer] = ixs;
		expect(create.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(true);
		expect(create.keys[1].pubkey.equals(ata(seller))).toBe(true);
		expect(create.keys[5].pubkey.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
		expect(transfer.programId.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
		expect(transfer.keys[0].pubkey.equals(ata(buyer))).toBe(true);
		expect(transfer.keys[2].pubkey.equals(ata(seller))).toBe(true);
		expect(transfer.keys.at(-1).pubkey.equals(reference)).toBe(true);
	});

	it('keeps a USDC price on the classic program', () => {
		const { ixs, buyer, ata } = build(USDC_MINT, TOKEN_PROGRAM_ID);
		expect(ixs[1].programId.equals(TOKEN_PROGRAM_ID)).toBe(true);
		expect(ixs[1].keys[0].pubkey.equals(ata(buyer))).toBe(true);
	});
});
