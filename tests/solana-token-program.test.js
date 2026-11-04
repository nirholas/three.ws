// The shared mint-to-token-program resolver and ATA derivation every Solana
// payment builder uses. $THREE is a Token-2022 mint, so an ATA derived under
// the classic program is an account that never exists on chain.
//
// Mainnet proof (2026-11-04, scripts/verify-token2022-purchase.mjs, simulated
// with sigVerify:false and replaceRecentBlockhash:true, nothing signed or sent):
// for a real $THREE holder, the gasless purchase (Token-2022 ATA create for a
// new seller, 5% fee leg, seller leg with the Solana Pay reference) and the
// Premium developer quote (29307010161 atomics at the Jupiter price) both
// returned err: null, each transfer a Token-2022 TransferChecked.

import { describe, it, expect, vi } from 'vitest';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import {
	ASSOCIATED_TOKEN_PROGRAM_ID,
	TOKEN_2022_PROGRAM_ID,
	TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

import {
	ataFor,
	knownTokenProgramForMint,
	tokenProgramForMint,
} from '../api/_lib/solana-token-program.js';

const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

function connectionOwnedBy(owner) {
	return { getAccountInfo: vi.fn(async () => (owner ? { owner, data: Buffer.alloc(82) } : null)) };
}

describe('tokenProgramForMint', () => {
	it('resolves a classic SPL mint to the Token program and caches it', async () => {
		const mint = Keypair.generate().publicKey;
		const conn = connectionOwnedBy(TOKEN_PROGRAM_ID);
		expect((await tokenProgramForMint(conn, mint)).equals(TOKEN_PROGRAM_ID)).toBe(true);
		expect((await tokenProgramForMint(conn, mint.toBase58())).equals(TOKEN_PROGRAM_ID)).toBe(true);
		expect(conn.getAccountInfo).toHaveBeenCalledTimes(1);
		expect(knownTokenProgramForMint(mint).equals(TOKEN_PROGRAM_ID)).toBe(true);
	});

	it('resolves a Token-2022 mint to the Token-2022 program', async () => {
		const mint = Keypair.generate().publicKey;
		const program = await tokenProgramForMint(connectionOwnedBy(TOKEN_2022_PROGRAM_ID), mint);
		expect(program.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
	});

	it('serves the $THREE mint as Token-2022 without an RPC read', async () => {
		const conn = connectionOwnedBy(null);
		expect((await tokenProgramForMint(conn, THREE_MINT)).equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
		expect(conn.getAccountInfo).not.toHaveBeenCalled();
	});

	it('throws mint_not_found for a mint account that does not exist, and caches nothing', async () => {
		const mint = Keypair.generate().publicKey;
		await expect(tokenProgramForMint(connectionOwnedBy(null), mint)).rejects.toMatchObject({
			code: 'mint_not_found',
		});
		expect(knownTokenProgramForMint(mint)).toBeNull();
	});

	it('throws mint_not_token for an account owned by any other program', async () => {
		const mint = Keypair.generate().publicKey;
		await expect(tokenProgramForMint(connectionOwnedBy(SystemProgram.programId), mint)).rejects.toMatchObject({
			code: 'mint_not_token',
		});
		expect(knownTokenProgramForMint(mint)).toBeNull();
	});
});

describe('ataFor', () => {
	const owner = Keypair.generate().publicKey;

	function expectedAta(mint, programId) {
		return PublicKey.findProgramAddressSync(
			[owner.toBuffer(), programId.toBuffer(), new PublicKey(mint).toBuffer()],
			ASSOCIATED_TOKEN_PROGRAM_ID,
		)[0];
	}

	it('derives the $THREE ATA under Token-2022, which differs from the classic derivation', () => {
		const ata = ataFor(THREE_MINT, owner, TOKEN_2022_PROGRAM_ID);
		expect(ata.equals(expectedAta(THREE_MINT, TOKEN_2022_PROGRAM_ID))).toBe(true);
		expect(ata.equals(expectedAta(THREE_MINT, TOKEN_PROGRAM_ID))).toBe(false);
	});

	it('derives a classic ATA under the Token program', () => {
		const mint = Keypair.generate().publicKey;
		expect(ataFor(mint, owner.toBase58(), TOKEN_PROGRAM_ID).equals(expectedAta(mint, TOKEN_PROGRAM_ID))).toBe(true);
	});

	it('refuses to derive without a token program instead of defaulting to the classic one', () => {
		expect(() => ataFor(THREE_MINT, owner)).toThrow(/token program/);
		expect(() => ataFor(THREE_MINT, owner, SystemProgram.programId)).toThrow(/token program/);
	});

	it('requires allowOwnerOffCurve for a PDA owner', () => {
		const [pda] = PublicKey.findProgramAddressSync([Buffer.from('vault')], TOKEN_PROGRAM_ID);
		expect(() => ataFor(THREE_MINT, pda, TOKEN_2022_PROGRAM_ID)).toThrow();
		expect(ataFor(THREE_MINT, pda, TOKEN_2022_PROGRAM_ID, { allowOwnerOffCurve: true })).toBeInstanceOf(PublicKey);
	});
});
