// Keypair loaders + SOL transfer helpers for coin distribution.
//
// Two keypairs are involved:
//
//   coin treasury (fee payer + transfer signer)
//     env: COIN_TREASURY_SECRET_KEY_B64
//     purpose: pays tx fees for all distribution ops AND signs SystemProgram.transfer
//              instructions when paying lottery winners / reflection drips. The
//              treasury holds the SOL that was previously claimed from the
//              pump.fun creator vault — distribution is just "move from
//              treasury to holders".
//
//   coin creator (pump.fun creator address for one specific launch)
//     env: COIN_CREATOR_SECRET_KEY_B64_<MINT>
//          or coin_launches.metadata.creator_secret_b64 (loaded by ID)
//     purpose: signs the `collectCreatorFee` instruction so pump.fun's program
//              releases creator-fee SOL to its associated token account, which
//              then gets unwrapped and routed to the treasury inside the same
//              transaction.

import { Keypair, PublicKey, SystemProgram, Transaction, ComputeBudgetProgram } from '@solana/web3.js';
import { getConnection } from '../pump.js';

const SOL_LAMPORTS = 1_000_000_000n;
const TX_MAX_TRANSFERS = 18; // SystemProgram.transfer is ~96 bytes; leaves room for compute-budget ix
const PRIORITY_MICRO_LAMPORTS = 50_000; // priority fee per CU — moderate competitive level

function decodeB64Keypair(b64, label) {
	if (!b64) throw new Error(`${label}: env not set`);
	const raw = Buffer.from(b64, 'base64');
	if (raw.byteLength !== 64) {
		throw new Error(`${label}: expected 64-byte secret key, got ${raw.byteLength}`);
	}
	return Keypair.fromSecretKey(raw);
}

/** Load the treasury keypair from env. Throws if unset. */
export function loadCoinTreasury() {
	return decodeB64Keypair(process.env.COIN_TREASURY_SECRET_KEY_B64, 'COIN_TREASURY_SECRET_KEY_B64');
}

/**
 * Load the pump.fun creator keypair for a specific mint.
 *
 * Lookup order:
 *   1. COIN_CREATOR_SECRET_KEY_B64_<MINT>  (env, deploy-time secret)
 *   2. coin.metadata.creator_secret_b64    (DB, set by the launch script)
 *
 * Returns null if neither source is configured (caller decides whether to
 * fall back to dry-run or error).
 */
export function loadCoinCreatorFromCoin(coin) {
	const mintKey = `COIN_CREATOR_SECRET_KEY_B64_${coin.mint}`;
	const envValue = process.env[mintKey];
	if (envValue) return decodeB64Keypair(envValue, mintKey);

	const dbValue = coin?.metadata?.creator_secret_b64;
	if (dbValue) return decodeB64Keypair(dbValue, 'coin.metadata.creator_secret_b64');

	return null;
}

/** Lamports → SOL string for log lines. */
export function lamportsToSol(lamports) {
	const big = typeof lamports === 'bigint' ? lamports : BigInt(lamports);
	const whole = big / SOL_LAMPORTS;
	const frac = big % SOL_LAMPORTS;
	return `${whole}.${frac.toString().padStart(9, '0')}`;
}

/**
 * Confirm a recent signature against the network with a bounded timeout.
 * Vercel function executions are short-lived; we don't want to hang on
 * confirmation if the cluster is slow.
 */
async function confirmWithTimeout(connection, signature, { commitment = 'confirmed', timeoutMs = 30_000 } = {}) {
	const start = Date.now();
	// First try the explicit confirm API; if that errors transiently, fall back
	// to polling getSignatureStatus.
	try {
		const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(commitment);
		await connection.confirmTransaction(
			{ signature, blockhash, lastValidBlockHeight },
			commitment,
		);
		return true;
	} catch {
		while (Date.now() - start < timeoutMs) {
			const status = await connection.getSignatureStatus(signature, {
				searchTransactionHistory: true,
			});
			const val = status?.value;
			if (val?.err) throw new Error('tx_failed: ' + JSON.stringify(val.err));
			if (val?.confirmationStatus === 'confirmed' || val?.confirmationStatus === 'finalized') {
				return true;
			}
			await new Promise((r) => setTimeout(r, 1_500));
		}
		throw new Error('confirm_timeout');
	}
}

/**
 * Send a single SystemProgram.transfer of `lamports` SOL from `from` to `to`.
 * Returns the tx signature on confirmation. Used for the lottery winner payout.
 *
 * @param {object} opts
 * @param {Keypair} opts.from        signing keypair (treasury) — pays fees + transfers
 * @param {string|PublicKey} opts.to recipient wallet
 * @param {bigint|number} opts.lamports
 * @param {'mainnet'|'devnet'} [opts.network]
 */
export async function sendSolTransfer({ from, to, lamports, network = 'mainnet' }) {
	const connection = getConnection({ network });
	const toPk = typeof to === 'string' ? new PublicKey(to) : to;
	const amount = typeof lamports === 'bigint' ? lamports : BigInt(lamports);
	if (amount <= 0n) throw new Error('sendSolTransfer: amount must be > 0');

	const tx = new Transaction();
	tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_MICRO_LAMPORTS }));
	tx.add(SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: toPk, lamports: amount }));
	tx.feePayer = from.publicKey;
	const { blockhash } = await connection.getLatestBlockhash('confirmed');
	tx.recentBlockhash = blockhash;
	tx.sign(from);

	const raw = tx.serialize();
	const sig = await connection.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 5 });
	await confirmWithTimeout(connection, sig);
	return sig;
}

/**
 * Send up to TX_MAX_TRANSFERS SystemProgram.transfer ix in a single tx.
 * Used as the inner primitive by sendSolBatched().
 */
async function sendChunk({ from, transfers, network }) {
	const connection = getConnection({ network });
	const tx = new Transaction();
	tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_MICRO_LAMPORTS }));
	for (const t of transfers) {
		tx.add(
			SystemProgram.transfer({
				fromPubkey: from.publicKey,
				toPubkey: typeof t.to === 'string' ? new PublicKey(t.to) : t.to,
				lamports: typeof t.lamports === 'bigint' ? t.lamports : BigInt(t.lamports),
			}),
		);
	}
	tx.feePayer = from.publicKey;
	const { blockhash } = await connection.getLatestBlockhash('confirmed');
	tx.recentBlockhash = blockhash;
	tx.sign(from);

	const sig = await connection.sendRawTransaction(tx.serialize(), {
		skipPreflight: false,
		maxRetries: 5,
	});
	await confirmWithTimeout(connection, sig);
	return sig;
}

/**
 * Send a batch of SOL transfers, splitting into multiple transactions when
 * the batch exceeds TX_MAX_TRANSFERS. Returns an array of result objects
 * matching the input order; each result has {recipients: [...], signature, error}.
 *
 * Failures inside one chunk DO NOT abort the rest — every chunk is attempted
 * and individually reported, so the caller can mark the successful payouts
 * confirmed in DB and re-queue the failed ones.
 *
 * @param {object} opts
 * @param {Keypair} opts.from
 * @param {Array<{ to: string, lamports: bigint|number, ref?: any }>} opts.transfers
 * @param {'mainnet'|'devnet'} [opts.network]
 */
export async function sendSolBatched({ from, transfers, network = 'mainnet' }) {
	const results = [];
	for (let i = 0; i < transfers.length; i += TX_MAX_TRANSFERS) {
		const chunk = transfers.slice(i, i + TX_MAX_TRANSFERS);
		try {
			const sig = await sendChunk({ from, transfers: chunk, network });
			results.push({ recipients: chunk, signature: sig, error: null });
		} catch (err) {
			results.push({
				recipients: chunk,
				signature: null,
				error: err?.message || String(err),
			});
		}
	}
	return results;
}

export { TX_MAX_TRANSFERS, PRIORITY_MICRO_LAMPORTS };
