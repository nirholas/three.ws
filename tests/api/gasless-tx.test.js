// Unit tests for the gasless (platform-sponsored) purchase transaction builder.
//
// Runs fully offline: real @solana/web3.js + @solana/spl-token and an
// in-memory RPC connection that serves a fixed blockhash, a real encoded mint
// account owned by the chosen token program, and token accounts that either
// exist or do not. Proves the platform is the fee-payer, that it pre-signs,
// that the buyer's authority is an unsigned slot, that the fee split and
// reference key land in the compiled message, and that a Token-2022 mint
// ($THREE) gets Token-2022 ATAs, transfers and decimals end to end.

import { describe, it, expect, beforeEach } from 'vitest';
import { Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import {
	ASSOCIATED_TOKEN_PROGRAM_ID,
	MINT_SIZE,
	MintLayout,
	TOKEN_2022_PROGRAM_ID,
	TOKEN_PROGRAM_ID,
	getAssociatedTokenAddressSync,
} from '@solana/spl-token';

import {
	buildGaslessPurchaseTx,
	resolveMarketplacePayer,
	_resetMarketplacePayerCache,
} from '../../api/_lib/solana/gasless-tx.js';

const PAYER = Keypair.generate();
const BUYER = Keypair.generate();
const SELLER = Keypair.generate();
const TREASURY = Keypair.generate();
const MINT = Keypair.generate(); // stand-in SPL mint
const REFERENCE = Keypair.generate().publicKey;

// A valid base58 32-byte string to stand in for a recent blockhash.
const FAKE_BLOCKHASH = Keypair.generate().publicKey.toBase58();

function encodedMint(decimals) {
	const data = Buffer.alloc(MINT_SIZE);
	MintLayout.encode(
		{
			mintAuthorityOption: 0,
			mintAuthority: PublicKey.default,
			supply: 1_000_000_000_000n,
			decimals,
			isInitialized: true,
			freezeAuthorityOption: 0,
			freezeAuthority: PublicKey.default,
		},
		data,
	);
	return data;
}

// `program` owns the mint; every token account exists unless listed in `missing`.
function makeConnection({ program = TOKEN_PROGRAM_ID, missing = [], mintDecimals = 6 } = {}) {
	const absent = new Set(missing.map((k) => k.toBase58()));
	return {
		getLatestBlockhash: async () => ({ blockhash: FAKE_BLOCKHASH, lastValidBlockHeight: 1 }),
		getAccountInfo: async () => ({
			owner: program,
			data: encodedMint(mintDecimals),
			lamports: 1_461_600,
			executable: false,
		}),
		getMultipleAccountsInfo: async (keys) =>
			keys.map((k) =>
				absent.has(k.toBase58())
					? null
					: { owner: program, data: Buffer.alloc(165), lamports: 2_039_280, executable: false },
			),
	};
}
const fakeConnection = makeConnection();

function setPayerEnv() {
	process.env.MARKETPLACE_PAYER_KEYPAIR = Buffer.from(PAYER.secretKey).toString('base64');
	_resetMarketplacePayerCache();
}

function clearPayerEnv() {
	delete process.env.MARKETPLACE_PAYER_KEYPAIR;
	delete process.env.PLATFORM_TREASURY_KEYPAIR;
	delete process.env.TREASURY_KEYPAIR;
	_resetMarketplacePayerCache();
}

const baseArgs = {
	connection: fakeConnection,
	buyerPublicKey: BUYER.publicKey.toBase58(),
	recipient: SELLER.publicKey.toBase58(),
	mint: MINT.publicKey.toBase58(),
	reference: REFERENCE.toBase58(),
	decimals: 6,
};

describe('buildGaslessPurchaseTx', () => {
	beforeEach(() => setPayerEnv());

	it('returns null when no payer keypair is configured', async () => {
		clearPayerEnv();
		const out = await buildGaslessPurchaseTx({ ...baseArgs, creatorAtomics: 1_000_000n });
		expect(out).toBeNull();
	});

	it('makes the platform payer the fee-payer and pre-signs it', async () => {
		const out = await buildGaslessPurchaseTx({ ...baseArgs, creatorAtomics: 1_000_000n });
		expect(out).not.toBeNull();
		expect(out.gasless).toBe(true);
		expect(out.feePayer).toBe(PAYER.publicKey.toBase58());

		const tx = VersionedTransaction.deserialize(Buffer.from(out.transaction, 'base64'));
		// Fee-payer is always the first static account key.
		expect(tx.message.staticAccountKeys[0].equals(PAYER.publicKey)).toBe(true);
		// The payer's signature slot is filled; the buyer's is still all-zero.
		const payerSig = tx.signatures[0];
		expect(payerSig.some((b) => b !== 0)).toBe(true);
	});

	it('leaves the buyer authority as an unsigned required signer', async () => {
		const out = await buildGaslessPurchaseTx({ ...baseArgs, creatorAtomics: 1_000_000n });
		const tx = VersionedTransaction.deserialize(Buffer.from(out.transaction, 'base64'));
		const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
		const buyerIdx = keys.indexOf(BUYER.publicKey.toBase58());
		expect(buyerIdx).toBeGreaterThan(0); // present, but not the fee-payer
		expect(buyerIdx).toBeLessThan(tx.message.header.numRequiredSignatures); // still a signer
		// Only the payer has signed so far.
		expect(tx.signatures[buyerIdx].every((b) => b === 0)).toBe(true);
	});

	it('includes the Solana Pay reference key in the message', async () => {
		const out = await buildGaslessPurchaseTx({ ...baseArgs, creatorAtomics: 1_000_000n });
		const tx = VersionedTransaction.deserialize(Buffer.from(out.transaction, 'base64'));
		expect(tx.message.staticAccountKeys.some((k) => k.equals(REFERENCE))).toBe(true);
	});

	it('adds a second transfer leg only when a platform fee applies', async () => {
		const single = await buildGaslessPurchaseTx({ ...baseArgs, creatorAtomics: 1_000_000n });
		const txSingle = VersionedTransaction.deserialize(Buffer.from(single.transaction, 'base64'));
		expect(txSingle.message.compiledInstructions).toHaveLength(1);

		const split = await buildGaslessPurchaseTx({
			...baseArgs,
			creatorAtomics: 900_000n,
			platformFeeAtomics: 100_000n,
			platformFeeWallet: TREASURY.publicKey.toBase58(),
		});
		const txSplit = VersionedTransaction.deserialize(Buffer.from(split.transaction, 'base64'));
		expect(txSplit.message.compiledInstructions).toHaveLength(2);
		// The treasury fee wallet's ATA owner is present in the account keys.
		expect(txSplit.message.staticAccountKeys.length).toBeGreaterThan(
			txSingle.message.staticAccountKeys.length,
		);
	});

	it('closes a split transaction with the reference-carrying seller leg', async () => {
		// @solana/pay's validateTransfer only inspects the LAST instruction and
		// requires the reference to ride it, so the fee leg must come first. With
		// the order flipped, confirm rejects a paid purchase as "invalid references".
		const split = await buildGaslessPurchaseTx({
			...baseArgs,
			creatorAtomics: 900_000n,
			platformFeeAtomics: 100_000n,
			platformFeeWallet: TREASURY.publicKey.toBase58(),
		});
		const tx = VersionedTransaction.deserialize(Buffer.from(split.transaction, 'base64'));
		const keys = tx.message.staticAccountKeys;
		const last = tx.message.compiledInstructions[tx.message.compiledInstructions.length - 1];
		expect(keys[last.accountKeyIndexes[last.accountKeyIndexes.length - 1]].equals(REFERENCE)).toBe(true);

		const sellerAta = getAssociatedTokenAddressSync(MINT.publicKey, SELLER.publicKey);
		expect(last.accountKeyIndexes.some((i) => keys[i].equals(sellerAta))).toBe(true);
	});
});

describe('buildGaslessPurchaseTx with a Token-2022 mint', () => {
	beforeEach(() => setPayerEnv());

	const MINT_2022 = Keypair.generate().publicKey; // stand-in Token-2022 mint, like $THREE
	const ata2022 = (owner) => getAssociatedTokenAddressSync(MINT_2022, owner, false, TOKEN_2022_PROGRAM_ID);
	const args2022 = {
		...baseArgs,
		mint: MINT_2022.toBase58(),
		creatorAtomics: 900_000n,
		platformFeeAtomics: 100_000n,
		platformFeeWallet: TREASURY.publicKey.toBase58(),
	};

	function decode(out) {
		const tx = VersionedTransaction.deserialize(Buffer.from(out.transaction, 'base64'));
		const keys = tx.message.staticAccountKeys;
		return tx.message.compiledInstructions.map((ix) => ({
			program: keys[ix.programIdIndex],
			accounts: ix.accountKeyIndexes.map((i) => keys[i]),
			data: Buffer.from(ix.data),
		}));
	}
	const TRANSFER_CHECKED = 12;

	it('addresses every transfer to Token-2022 and moves tokens between the Token-2022 ATAs', async () => {
		const out = await buildGaslessPurchaseTx({
			...args2022,
			connection: makeConnection({ program: TOKEN_2022_PROGRAM_ID }),
		});
		const transfers = decode(out).filter((ix) => ix.data[0] === TRANSFER_CHECKED);
		expect(transfers).toHaveLength(2);
		for (const ix of transfers) {
			expect(ix.program.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
			expect(ix.accounts[0].equals(ata2022(BUYER.publicKey))).toBe(true);
			expect(ix.accounts[1].equals(MINT_2022)).toBe(true);
		}
		expect(transfers[0].accounts[2].equals(ata2022(TREASURY.publicKey))).toBe(true);
		expect(transfers[1].accounts[2].equals(ata2022(SELLER.publicKey))).toBe(true);
		expect(transfers[1].accounts.at(-1).equals(REFERENCE)).toBe(true);
	});

	it('reads the decimals of a Token-2022 mint from the Token-2022 program when none are passed', async () => {
		const out = await buildGaslessPurchaseTx({
			...args2022,
			decimals: undefined,
			connection: makeConnection({ program: TOKEN_2022_PROGRAM_ID, mintDecimals: 6 }),
		});
		const transfers = decode(out).filter((ix) => ix.data[0] === TRANSFER_CHECKED);
		expect(transfers.map((ix) => ix.data[9])).toEqual([6, 6]);
	});

	it('creates the missing seller and treasury ATAs idempotently, paid by the platform payer, before the transfers', async () => {
		const out = await buildGaslessPurchaseTx({
			...args2022,
			connection: makeConnection({
				program: TOKEN_2022_PROGRAM_ID,
				missing: [ata2022(SELLER.publicKey), ata2022(TREASURY.publicKey)],
			}),
		});
		const ixs = decode(out);
		expect(ixs).toHaveLength(4);
		const creates = ixs.slice(0, 2);
		for (const ix of creates) {
			expect(ix.program.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(true);
			expect(ix.data[0]).toBe(1); // CreateIdempotent
			expect(ix.accounts[0].equals(PAYER.publicKey)).toBe(true); // rent payer
			expect(ix.accounts[3].equals(MINT_2022)).toBe(true);
			expect(ix.accounts[5].equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
		}
		expect(creates.map((ix) => ix.accounts[1].toBase58()).sort()).toEqual(
			[ata2022(SELLER.publicKey), ata2022(TREASURY.publicKey)].map((k) => k.toBase58()).sort(),
		);
		const last = ixs.at(-1);
		expect(last.data[0]).toBe(TRANSFER_CHECKED);
		expect(last.accounts[2].equals(ata2022(SELLER.publicKey))).toBe(true);
		expect(last.accounts.at(-1).equals(REFERENCE)).toBe(true);
	});

	it('adds no create instruction for an ATA that already exists', async () => {
		const out = await buildGaslessPurchaseTx({
			...args2022,
			connection: makeConnection({ program: TOKEN_2022_PROGRAM_ID, missing: [ata2022(SELLER.publicKey)] }),
		});
		const creates = decode(out).filter((ix) => ix.program.equals(ASSOCIATED_TOKEN_PROGRAM_ID));
		expect(creates).toHaveLength(1);
		expect(creates[0].accounts[1].equals(ata2022(SELLER.publicKey))).toBe(true);
	});
});

describe('resolveMarketplacePayer', () => {
	it('falls back to PLATFORM_TREASURY_KEYPAIR when the dedicated var is unset', async () => {
		clearPayerEnv();
		process.env.PLATFORM_TREASURY_KEYPAIR = Buffer.from(PAYER.secretKey).toString('base64');
		_resetMarketplacePayerCache();
		const kp = await resolveMarketplacePayer();
		expect(kp).not.toBeNull();
		expect(kp.publicKey.equals(PAYER.publicKey)).toBe(true);
		clearPayerEnv();
	});
});
