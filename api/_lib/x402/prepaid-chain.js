// api/_lib/x402/prepaid-chain.js
//
// The on-chain legs of the prepaid rail, kept apart from the ledger so the
// arithmetic can be tested against a bare database:
//
//   · verifyPrepaidDeposit - confirm a finalized USDC transfer into the settler
//     wallet and name who sent it. The credited account belongs to that sender.
//   · sendBatchTransfers   - ONE transaction paying every batch's seller, with a
//     memo naming the batch ids.
//
// Solana only; USDC only. An EVM leg would be added alongside, never instead.

import {
	PublicKey,
	TransactionInstruction,
} from '@solana/web3.js';
import {
	createAssociatedTokenAccountIdempotentInstruction,
	createTransferCheckedInstruction,
	getAssociatedTokenAddress,
} from '@solana/spl-token';
import { env } from '../env.js';
import { solanaConnection } from '../solana/connection.js';
import { ataExists } from '../solana/read-guards.js';
import { submitProtected } from '../execution-engine.js';
import { tokenProgramIdForMint } from '../token/token-program.js';
import { loadSignerKeypair, SOLANA_SIGNERS } from '../solana-signers.js';
import { PREPAID_NETWORK, USDC_MINT_SOLANA, USDC_DECIMALS, PREPAID_ASSET } from './prepaid-constants.js';

export { PREPAID_NETWORK, USDC_MINT_SOLANA, USDC_DECIMALS, PREPAID_ASSET };

const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const SETTLER_SPEC = SOLANA_SIGNERS.find((s) => s.name === 'x402-prepaid-settler');

function chainError(message, status, code) {
	return Object.assign(new Error(message), { status, code });
}

/** The settler keypair, or null when X402_PREPAID_SETTLER_SECRET_BASE58 is unset or corrupt. */
export async function loadSettler() {
	const { keypair } = await loadSignerKeypair(SETTLER_SPEC);
	return keypair;
}

/**
 * Where buyers send a deposit: X402_PREPAID_DEPOSIT_WALLET if set, else the
 * settler's own address (the wallet that can pay sellers out of it).
 * @returns {Promise<string|null>}
 */
export async function prepaidDepositWallet() {
	const override = (env.X402_PREPAID_DEPOSIT_WALLET || '').trim();
	if (override) return override;
	const settler = await loadSettler();
	return settler ? settler.publicKey.toBase58() : null;
}

function keyStr(k) {
	return k?.pubkey?.toString?.() || String(k?.pubkey ?? '');
}

/**
 * Verify a deposit transaction and report the sender and the USDC credited.
 * Finalized commitment only: a reorged deposit must not stay credited.
 *
 * @param {string} signature
 * @returns {Promise<{ pending: true } | { pending: false, payer: string, amountAtomics: bigint }>}
 */
export async function verifyPrepaidDeposit(signature) {
	const sink = await prepaidDepositWallet();
	if (!sink) throw chainError('the prepaid deposit wallet is not configured', 503, 'deposit_unavailable');
	if (typeof signature !== 'string' || signature.length < 32 || signature.length > 128) {
		throw chainError('a valid tx_signature is required', 400, 'bad_request');
	}
	const connection = solanaConnection({ network: 'mainnet', commitment: 'finalized' });
	let tx = null;
	try {
		tx = await connection.getParsedTransaction(signature, {
			maxSupportedTransactionVersion: 1,
			commitment: 'finalized',
		});
	} catch {
		tx = null;
	}
	if (!tx) {
		const { value } = await connection
			.getSignatureStatuses([signature], { searchTransactionHistory: true })
			.catch(() => ({ value: [] }));
		const status = value?.[0];
		if (status?.err) throw chainError('transaction failed on-chain', 422, 'tx_failed');
		if (status) return { pending: true };
		throw chainError('transaction not found', 422, 'tx_not_found');
	}
	if (tx.meta?.err) throw chainError('transaction failed on-chain', 422, 'tx_failed');

	const pre = tx.meta?.preTokenBalances || [];
	const post = tx.meta?.postTokenBalances || [];
	let received = 0n;
	for (const p of post) {
		if (p.mint !== USDC_MINT_SOLANA || p.owner !== sink) continue;
		const before = pre.find((x) => x.accountIndex === p.accountIndex);
		received += BigInt(p.uiTokenAmount?.amount ?? '0') - BigInt(before?.uiTokenAmount?.amount ?? '0');
	}
	if (received <= 0n) {
		throw chainError('this transaction did not send USDC to the prepaid deposit wallet', 422, 'no_deposit_found');
	}

	// The sender is the owner whose USDC balance fell, and it must have signed.
	const signers = new Set(
		(tx.transaction?.message?.accountKeys || []).filter((k) => k.signer).map(keyStr),
	);
	const senders = [];
	for (const b of pre) {
		if (b.mint !== USDC_MINT_SOLANA || !b.owner || b.owner === sink) continue;
		const after = post.find((x) => x.accountIndex === b.accountIndex);
		const delta = BigInt(after?.uiTokenAmount?.amount ?? '0') - BigInt(b.uiTokenAmount?.amount ?? '0');
		if (delta < 0n && signers.has(b.owner)) senders.push(b.owner);
	}
	if (senders.length !== 1) {
		throw chainError(
			'the deposit must come from exactly one signing wallet; send it from the wallet that will spend the balance',
			422,
			'deposit_sender_ambiguous',
		);
	}
	return { pending: false, payer: senders[0], amountAtomics: received };
}

/**
 * Pay every batch's seller in one transaction. Throws with `code: 'PRE_SEND'`
 * for anything that fails before a transaction could have been broadcast, so the
 * batcher can release the debits safely.
 *
 * @param {Array<{ id: string, payee: string, asset: string, totalAtomics: bigint }>} batches
 * @returns {Promise<string>} the confirmed transaction signature
 */
export async function sendBatchTransfers(batches) {
	const preSend = (err) => Object.assign(err, { code: err.code || 'PRE_SEND' });
	let settler;
	let built;
	const connection = solanaConnection({ network: 'mainnet', commitment: 'confirmed' });
	try {
		settler = await loadSettler();
		if (!settler) throw new Error('X402_PREPAID_SETTLER_SECRET_BASE58 is not configured');
		const mint = new PublicKey(USDC_MINT_SOLANA);
		const programId = await tokenProgramIdForMint(connection, mint);
		const sourceAta = await getAssociatedTokenAddress(mint, settler.publicKey, false, programId);
		const instructions = [];
		for (const b of batches) {
			if (b.asset !== USDC_MINT_SOLANA) throw new Error(`unsupported asset ${b.asset}`);
			const payee = new PublicKey(b.payee);
			const dest = await getAssociatedTokenAddress(mint, payee, true, programId);
			if (!(await ataExists(connection, dest))) {
				instructions.push(
					createAssociatedTokenAccountIdempotentInstruction(settler.publicKey, dest, payee, mint, programId),
				);
			}
			instructions.push(
				createTransferCheckedInstruction(sourceAta, mint, dest, settler.publicKey, b.totalAtomics, USDC_DECIMALS, [], programId),
			);
		}
		instructions.push(
			new TransactionInstruction({
				programId: MEMO_PROGRAM_ID,
				keys: [],
				data: Buffer.from(`three.ws x402 prepaid settle ${batches.map((b) => b.id).join(',')}`),
			}),
		);
		built = instructions;
	} catch (err) {
		throw preSend(err);
	}
	const { signature } = await submitProtected({
		network: 'mainnet',
		connection,
		payer: settler,
		instructions: built,
	});
	return signature;
}

/**
 * USDC atomics the deposit wallet actually holds, for the float check. Null when
 * no deposit wallet is configured or the chain could not be read, so a caller
 * reports "unknown" instead of a false shortfall.
 * @returns {Promise<bigint|null>}
 */
export async function depositWalletUsdcBalance() {
	const wallet = await prepaidDepositWallet();
	if (!wallet) return null;
	try {
		const connection = solanaConnection({ network: 'mainnet', commitment: 'confirmed' });
		const mint = new PublicKey(USDC_MINT_SOLANA);
		const programId = await tokenProgramIdForMint(connection, mint);
		const ata = await getAssociatedTokenAddress(mint, new PublicKey(wallet), true, programId);
		const bal = await connection.getTokenAccountBalance(ata, 'confirmed');
		return BigInt(bal.value.amount);
	} catch {
		return null;
	}
}
