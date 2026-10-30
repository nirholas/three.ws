// Solana Pay verification over @solana/pay 1.x (kit-based).
//
// The transactions here are the real wire bytes: the SPL purchase comes from
// the production gasless builder, the SOL tip is a web3.js transfer with a memo.
// Only the RPC transport is replaced, serving getTransaction /
// getSignaturesForAddress responses shaped exactly like a node's (base64
// transaction + balance meta), so the real kit decoders, the real program-client
// parsers and @solana/pay's own checks all run.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import BigNumber from 'bignumber.js';
import {
	Keypair,
	PublicKey,
	SystemProgram,
	TransactionInstruction,
	TransactionMessage,
	VersionedTransaction,
} from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { createSolanaRpcFromTransport, getBase58Decoder } from '@solana/kit';

const node = { transactions: new Map(), signatures: new Map() };

vi.mock('../api/_lib/solana/kit-rpc.js', () => ({
	solanaKitRpc: () =>
		createSolanaRpcFromTransport(async ({ payload }) => {
			const [first] = payload.params;
			let result = null;
			if (payload.method === 'getTransaction') result = node.transactions.get(first) ?? null;
			if (payload.method === 'getSignaturesForAddress') result = node.signatures.get(first) ?? [];
			return { jsonrpc: '2.0', id: payload.id, result };
		}),
}));

const { findReference, validateTransfer, FindReferenceError, ValidateTransferError } = await import(
	'../api/_lib/solana/solana-pay-verify.js'
);
const { buildGaslessPurchaseTx, _resetMarketplacePayerCache } = await import(
	'../api/_lib/solana/gasless-tx.js'
);

// The memo program wallets emit for Solana Pay requests (spl-memo v3).
// @solana-program/memo >=0.14 exports the v4 address instead, which @solana/pay
// compares against by strict equality; this fixture pins that down.
const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const PAYER = Keypair.generate();
const BUYER = Keypair.generate();
const SELLER = Keypair.generate();
const TREASURY = Keypair.generate();
const MINT = Keypair.generate().publicKey;
const BLOCKHASH = Keypair.generate().publicKey.toBase58();

const base58 = getBase58Decoder();
// A syntactically valid 64-byte base58 signature, unique per test tx.
const nextSignature = () => base58.decode(crypto.getRandomValues(new Uint8Array(64)));

/** Serve `tx` as a confirmed transaction with the given balance deltas. */
function landOnNode(tx, { lamports = {}, tokens = [] } = {}) {
	const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
	const preBalances = keys.map(() => 5_000_000_000);
	const postBalances = keys.map((k, i) => preBalances[i] + (lamports[k] ?? 0));
	const tokenBalance = (accountIndex, amount) => ({
		accountIndex,
		mint: MINT.toBase58(),
		owner: null,
		programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
		uiTokenAmount: { amount: String(amount), decimals: 6, uiAmount: null, uiAmountString: '0' },
	});
	const preTokenBalances = [];
	const postTokenBalances = [];
	for (const { account, delta } of tokens) {
		const idx = keys.indexOf(account.toBase58());
		preTokenBalances.push(tokenBalance(idx, 10_000_000));
		postTokenBalances.push(tokenBalance(idx, 10_000_000 + delta));
	}
	const sig = nextSignature();
	node.transactions.set(sig, {
		slot: 1000,
		blockTime: 1_760_000_000,
		version: 0,
		transaction: [Buffer.from(tx.serialize()).toString('base64'), 'base64'],
		meta: {
			err: null,
			status: { Ok: null },
			fee: 5000,
			preBalances,
			postBalances,
			preTokenBalances,
			postTokenBalances,
			innerInstructions: [],
			logMessages: [],
			rewards: [],
			loadedAddresses: { readonly: [], writable: [] },
			computeUnitsConsumed: 1000,
		},
	});
	return sig;
}

async function gaslessPurchase({ creatorAtomics, platformFeeAtomics = 0n, reference }) {
	const out = await buildGaslessPurchaseTx({
		connection: { getLatestBlockhash: async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 1 }) },
		buyerPublicKey: BUYER.publicKey.toBase58(),
		recipient: SELLER.publicKey.toBase58(),
		mint: MINT.toBase58(),
		reference: reference.toBase58(),
		decimals: 6,
		creatorAtomics,
		platformFeeAtomics,
		platformFeeWallet: platformFeeAtomics > 0n ? TREASURY.publicKey.toBase58() : null,
	});
	return VersionedTransaction.deserialize(Buffer.from(out.transaction, 'base64'));
}

const sellerAta = getAssociatedTokenAddressSync(MINT, SELLER.publicKey);
const treasuryAta = getAssociatedTokenAddressSync(MINT, TREASURY.publicKey);

beforeEach(() => {
	node.transactions.clear();
	node.signatures.clear();
	process.env.MARKETPLACE_PAYER_KEYPAIR = Buffer.from(PAYER.secretKey).toString('base64');
	_resetMarketplacePayerCache();
});

describe('validateTransfer (SPL, gasless purchase builder)', () => {
	it('accepts the seller leg of a split purchase with a BigNumber UI amount', async () => {
		const reference = Keypair.generate().publicKey;
		const tx = await gaslessPurchase({ creatorAtomics: 1_350_000n, platformFeeAtomics: 150_000n, reference });
		const sig = landOnNode(tx, {
			tokens: [
				{ account: sellerAta, delta: 1_350_000 },
				{ account: treasuryAta, delta: 150_000 },
			],
		});
		const res = await validateTransfer(sig, {
			recipient: SELLER.publicKey,
			amount: new BigNumber(1_350_000).dividedBy(new BigNumber(10).pow(6)),
			splToken: MINT,
			reference,
		});
		expect(res.meta.err).toBeNull();
	});

	it('rejects a seller leg that received less than the price', async () => {
		const reference = Keypair.generate().publicKey;
		const tx = await gaslessPurchase({ creatorAtomics: 1_000_000n, reference });
		const sig = landOnNode(tx, { tokens: [{ account: sellerAta, delta: 999_999 }] });
		await expect(
			validateTransfer(sig, { recipient: SELLER.publicKey, amount: new BigNumber('1'), splToken: MINT, reference }),
		).rejects.toThrow(/amount not transferred/);
	});

	it('rejects a transaction bound to a different reference', async () => {
		const tx = await gaslessPurchase({ creatorAtomics: 1_000_000n, reference: Keypair.generate().publicKey });
		const sig = landOnNode(tx, { tokens: [{ account: sellerAta, delta: 1_000_000 }] });
		const err = await validateTransfer(sig, {
			recipient: SELLER.publicKey,
			amount: 1,
			splToken: MINT,
			reference: Keypair.generate().publicKey,
		}).catch((e) => e);
		expect(err).toBeInstanceOf(ValidateTransferError);
		expect(err.message).toMatch(/invalid reference/);
	});

	it('rejects a payment to someone other than the seller', async () => {
		const reference = Keypair.generate().publicKey;
		const tx = await gaslessPurchase({ creatorAtomics: 1_000_000n, reference });
		const sig = landOnNode(tx, { tokens: [{ account: sellerAta, delta: 1_000_000 }] });
		await expect(
			validateTransfer(sig, { recipient: TREASURY.publicKey, amount: 1, splToken: MINT, reference }),
		).rejects.toThrow(ValidateTransferError);
	});

	it('reports a signature the node has never seen as not found', async () => {
		await expect(
			validateTransfer(nextSignature(), { recipient: SELLER.publicKey, amount: 1, splToken: MINT }),
		).rejects.toThrow(/not found/);
	});
});

describe('validateTransfer (SOL with memo)', () => {
	function solTip({ lamports, memo, reference }) {
		const transfer = SystemProgram.transfer({
			fromPubkey: BUYER.publicKey,
			toPubkey: SELLER.publicKey,
			lamports,
		});
		transfer.keys.push({ pubkey: reference, isSigner: false, isWritable: false });
		const memoIx = new TransactionInstruction({ programId: MEMO_PROGRAM, keys: [], data: Buffer.from(memo) });
		const message = new TransactionMessage({
			payerKey: BUYER.publicKey,
			recentBlockhash: BLOCKHASH,
			instructions: [memoIx, transfer],
		}).compileToV0Message();
		return new VersionedTransaction(message);
	}

	it('accepts a reference-bound SOL transfer whose memo matches', async () => {
		const reference = Keypair.generate().publicKey;
		const tx = solTip({ lamports: 250_000_000, memo: 'order-42', reference });
		const sig = landOnNode(tx, { lamports: { [SELLER.publicKey.toBase58()]: 250_000_000 } });
		await expect(
			validateTransfer(sig, { recipient: SELLER.publicKey, amount: '0.25', reference, memo: 'order-42' }),
		).resolves.toBeTruthy();
	});

	it('rejects a memo that does not match', async () => {
		const reference = Keypair.generate().publicKey;
		const tx = solTip({ lamports: 250_000_000, memo: 'order-41', reference });
		const sig = landOnNode(tx, { lamports: { [SELLER.publicKey.toBase58()]: 250_000_000 } });
		await expect(
			validateTransfer(sig, { recipient: SELLER.publicKey, amount: 0.25, reference, memo: 'order-42' }),
		).rejects.toThrow(/invalid memo/);
	});
});

describe('findReference', () => {
	it('returns the oldest signature carrying the reference', async () => {
		const reference = Keypair.generate().publicKey;
		const [newer, older] = [nextSignature(), nextSignature()];
		node.signatures.set(reference.toBase58(), [
			{ signature: newer, slot: 12, err: null, memo: null, blockTime: 2, confirmationStatus: 'confirmed' },
			{ signature: older, slot: 11, err: null, memo: null, blockTime: 1, confirmationStatus: 'confirmed' },
		]);
		const found = await findReference(reference);
		expect(found.signature).toBe(older);
	});

	it('throws FindReferenceError while nothing references the key', async () => {
		const err = await findReference(Keypair.generate().publicKey.toBase58()).catch((e) => e);
		expect(err).toBeInstanceOf(FindReferenceError);
		// The confirm handlers treat this message as "still pending".
		expect(/FindReferenceError|not found/i.test(err.message)).toBe(true);
	});
});
