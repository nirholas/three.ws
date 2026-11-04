// transferSolanaUSDC is the platform's mint-generic SPL payout rail: tournament
// prizes (THREE_TOKEN_MINT), cosmetics creator splits, remix royalties, vanity
// bounties and tokenize-3d payouts all call it with whatever mint they settle in.
//
// $THREE (FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump) is a Token-2022 mint. The
// helper used to derive both ATAs and the transfer with the default classic SPL
// Token program, so a $THREE payout named a source account the treasury does not
// own, sent the instruction to a program that does not own the mint, and failed
// on-chain. Every payout must be built on the mint's own program, and as a
// TransferChecked so the chain validates the amount against the mint's decimals.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import {
	ASSOCIATED_TOKEN_PROGRAM_ID,
	TOKEN_PROGRAM_ID,
	TOKEN_2022_PROGRAM_ID,
	TokenInstruction,
	getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import bs58 from 'bs58';

const THREE_MINT = new PublicKey('FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump');
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

const sent = vi.hoisted(() => ({ instructions: null, exists: false }));

vi.mock('../api/_lib/solana/connection.js', () => ({ solanaConnection: () => ({}) }));
vi.mock('../api/_lib/solana/read-guards.js', async (importOriginal) => ({
	...(await importOriginal()),
	ataExists: async () => sent.exists,
}));
vi.mock('../api/_lib/execution-engine.js', () => ({
	submitProtected: async ({ instructions }) => {
		sent.instructions = instructions;
		return { signature: 'sig' };
	},
}));

const { transferSolanaUSDC } = await import('../api/_lib/solana-transfer.js');

const treasury = Keypair.generate();
const recipient = Keypair.generate().publicKey;

beforeEach(() => {
	sent.instructions = null;
	sent.exists = false;
});

async function pay(mint, amount = 1_500_000n) {
	await transferSolanaUSDC({
		fromWallet: bs58.encode(treasury.secretKey),
		toAddress: recipient.toBase58(),
		amount,
		mint: mint.toBase58(),
	});
	return sent.instructions;
}

describe('transferSolanaUSDC', () => {
	it('pays $THREE between Token-2022 ATAs as a TransferChecked on the Token-2022 program', async () => {
		const ata = (owner) => getAssociatedTokenAddressSync(THREE_MINT, owner, false, TOKEN_2022_PROGRAM_ID);
		const [create, transfer] = await pay(THREE_MINT);
		expect(create.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(true);
		expect(create.keys[1].pubkey.equals(ata(recipient))).toBe(true);
		expect(create.keys[5].pubkey.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
		expect(transfer.programId.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
		expect(transfer.data[0]).toBe(TokenInstruction.TransferChecked);
		expect(transfer.keys[0].pubkey.equals(ata(treasury.publicKey))).toBe(true);
		expect(transfer.keys[1].pubkey.equals(THREE_MINT)).toBe(true);
		expect(transfer.keys[2].pubkey.equals(ata(recipient))).toBe(true);
		expect(transfer.data.readBigUInt64LE(1)).toBe(1_500_000n);
		expect(transfer.data[9]).toBe(6);
	});

	it('keeps a USDC payout on the classic program', async () => {
		const ata = (owner) => getAssociatedTokenAddressSync(USDC_MINT, owner, false, TOKEN_PROGRAM_ID);
		const [create, transfer] = await pay(USDC_MINT);
		expect(create.keys[5].pubkey.equals(TOKEN_PROGRAM_ID)).toBe(true);
		expect(transfer.programId.equals(TOKEN_PROGRAM_ID)).toBe(true);
		expect(transfer.keys[0].pubkey.equals(ata(treasury.publicKey))).toBe(true);
		expect(transfer.keys[2].pubkey.equals(ata(recipient))).toBe(true);
	});

	it('skips the create when the recipient already holds the mint', async () => {
		sent.exists = true;
		const ixs = await pay(THREE_MINT);
		expect(ixs).toHaveLength(1);
		expect(ixs[0].programId.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
	});
});
