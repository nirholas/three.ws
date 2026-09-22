// Unsigned Solana transaction builders shared by every non-custodial path:
// /api/tx/solana/build-{transfer,swap}, the external-signer branch of the agent
// withdraw and trade routes, and the session-key grant.
//
// Builders never sign and never broadcast. They return a VersionedTransaction
// (a legacy message is wrapped as-is, so the wire format a wallet sees is
// unchanged) plus a plain-language summary that the pending-transaction row
// stores and the custody ledger later records.

import {
	PublicKey, Transaction, SystemProgram, TransactionInstruction, VersionedTransaction,
} from '@solana/web3.js';
import {
	createTransferCheckedInstruction, getMint, getAssociatedTokenAddressSync,
	createAssociatedTokenAccountInstruction,
	TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { jupiterQuote, jupiterSwapTx } from '../token/jupiter.js';

export const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
// The memo program accepts up to 566 bytes of instruction data; cap below that
// so an oversized memo is a 400 instead of a serialize failure.
export const MEMO_MAX_BYTES = 512;
export const MAX_UI_AMOUNT = 1e12;

export const USDC_MINT_BY_NETWORK = Object.freeze({
	mainnet: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
	devnet: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
});

/** A tagged client error; routes map `status` + `code` straight to the response. */
export function clientError(code, message, status = 400) {
	return Object.assign(new Error(message), { status, code, expose: true });
}

export function upstreamError(message) {
	return Object.assign(new Error(message), { status: 502, code: 'upstream_error', expose: true });
}

/**
 * UI amount to raw base units without a float multiply: render at the mint's
 * precision, then shift the decimal point in string space.
 */
export function toRawUnits(amount, decimals) {
	const [whole, frac = ''] = Number(amount).toFixed(decimals).split('.');
	return BigInt(whole + frac.padEnd(decimals, '0'));
}

/** Raw base units to a UI number (display only, never fed back into math). */
export function fromRawUnits(raw, decimals) {
	return Number(BigInt(raw)) / 10 ** decimals;
}

/**
 * Which token program owns a mint, plus its decimals. Token-2022 mints (every
 * pump.fun-era coin, $THREE included) need TOKEN_2022_PROGRAM_ID end to end.
 */
export async function resolveMint(connection, mintPk) {
	let account;
	try {
		account = await connection.getAccountInfo(mintPk);
	} catch (err) {
		throw upstreamError(`mint lookup failed upstream: ${err?.message || 'rpc error'}`);
	}
	if (!account) throw clientError('invalid_mint', 'token mint not found on this network');

	const programId = account.owner.equals(TOKEN_2022_PROGRAM_ID)
		? TOKEN_2022_PROGRAM_ID
		: account.owner.equals(TOKEN_PROGRAM_ID)
			? TOKEN_PROGRAM_ID
			: null;
	if (!programId) throw clientError('invalid_mint', 'address is not an SPL token mint');

	let info;
	try {
		info = await getMint(connection, mintPk, 'confirmed', programId);
	} catch {
		throw clientError('invalid_mint', 'could not read token mint');
	}
	return { programId, decimals: info.decimals };
}

/**
 * Associated token account, answering 400 when the owner is off-curve (a PDA
 * has no standard ATA and no key to sign with).
 */
export function associatedTokenAddress(mint, owner, programId, side) {
	try {
		return getAssociatedTokenAddressSync(mint, owner, false, programId, ASSOCIATED_TOKEN_PROGRAM_ID);
	} catch {
		throw clientError('invalid_owner', `${side} is a program-derived address and has no associated token account`);
	}
}

async function latestBlockhash(connection) {
	try {
		return await connection.getLatestBlockhash('confirmed');
	} catch (err) {
		throw upstreamError(`blockhash fetch failed upstream: ${err?.message || 'rpc error'}`);
	}
}

/** Wrap a legacy Transaction as a VersionedTransaction with the same message bytes. */
export function toVersioned(tx) {
	return new VersionedTransaction(tx.compileMessage());
}

/**
 * Build an unsigned SOL or SPL transfer with `sender` as fee payer and authority.
 * Refuses up front when an SPL sender holds too little, so the signer is never
 * asked to approve a transaction that can only fail on-chain.
 *
 * @returns {Promise<{ transaction: VersionedTransaction, lastValidBlockHeight: number,
 *   blockhash: string, summary: object }>}
 */
export async function buildTransferTransaction({ connection, sender, recipient, amount, token = 'SOL', memo = null, network = 'mainnet' }) {
	const senderPk = new PublicKey(sender);
	const recipientPk = new PublicKey(recipient);
	if (senderPk.equals(recipientPk)) throw clientError('invalid_recipient', 'sender and recipient are the same address');
	const tx = new Transaction();
	let summary;

	if (token === 'SOL') {
		const lamports = toRawUnits(amount, 9);
		if (lamports <= 0n) throw clientError('invalid_amount', 'amount rounds to zero lamports');
		if (lamports > BigInt(Number.MAX_SAFE_INTEGER)) throw clientError('invalid_amount', 'amount is too large');
		tx.add(SystemProgram.transfer({ fromPubkey: senderPk, toPubkey: recipientPk, lamports }));
		summary = { action: 'transfer', asset: 'SOL', decimals: 9, amount_raw: lamports.toString(), amount: Number(amount), from: sender, to: recipient, network };
	} else {
		const mint = new PublicKey(token);
		const { programId, decimals } = await resolveMint(connection, mint);
		const raw = toRawUnits(amount, decimals);
		if (raw <= 0n) throw clientError('invalid_amount', `amount rounds to zero at ${decimals} decimals`);

		const senderAta = associatedTokenAddress(mint, senderPk, programId, 'sender');
		const recipientAta = associatedTokenAddress(mint, recipientPk, programId, 'recipient');

		let balance = 0n;
		try {
			const bal = await connection.getTokenAccountBalance(senderAta);
			balance = BigInt(bal.value.amount);
		} catch {
			balance = 0n;
		}
		if (balance < raw) throw clientError('insufficient_balance', 'sender holds less of this token than the requested amount');

		let recipientAccount;
		try {
			recipientAccount = await connection.getAccountInfo(recipientAta);
		} catch (err) {
			throw upstreamError(`recipient account lookup failed upstream: ${err?.message || 'rpc error'}`);
		}
		if (!recipientAccount) {
			tx.add(createAssociatedTokenAccountInstruction(senderPk, recipientAta, recipientPk, mint, programId, ASSOCIATED_TOKEN_PROGRAM_ID));
		}
		// TransferChecked: Token-2022 transfer-fee mints reject the unchecked variant.
		tx.add(createTransferCheckedInstruction(senderAta, mint, recipientAta, senderPk, raw, decimals, [], programId));
		summary = { action: 'transfer', asset: token, decimals, amount_raw: raw.toString(), amount: Number(amount), from: sender, to: recipient, network };
	}

	if (memo) {
		if (Buffer.byteLength(memo, 'utf8') > MEMO_MAX_BYTES) throw clientError('invalid_memo', `memo must be at most ${MEMO_MAX_BYTES} bytes`);
		tx.add(new TransactionInstruction({ keys: [], programId: MEMO_PROGRAM_ID, data: Buffer.from(memo, 'utf8') }));
		summary.memo = memo;
	}

	const bh = await latestBlockhash(connection);
	tx.feePayer = senderPk;
	tx.recentBlockhash = bh.blockhash;
	return { transaction: toVersioned(tx), blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight, summary };
}

/**
 * Build an unsigned Jupiter swap for `sender`. Mainnet only: Jupiter routes
 * mainnet liquidity.
 */
export async function buildSwapTransaction({ connection, sender, inputMint, outputMint, amount, slippageBps = 50 }) {
	if (inputMint === outputMint) throw clientError('invalid_route', 'inputMint and outputMint must differ');
	const { decimals: inDecimals } = await resolveMint(connection, new PublicKey(inputMint));
	const { decimals: outDecimals } = await resolveMint(connection, new PublicKey(outputMint));
	const raw = toRawUnits(amount, inDecimals);
	if (raw <= 0n) throw clientError('invalid_amount', `amount rounds to zero at ${inDecimals} decimals`);

	let quote;
	try {
		quote = await jupiterQuote({ inputMint, outputMint, amount: raw.toString(), slippageBps });
	} catch (err) {
		if (err?.status >= 400 && err.status < 500) throw clientError('no_route', 'No swap route found for this pair and amount', 422);
		throw upstreamError(`swap quote failed upstream: ${err?.message || 'network error'}`);
	}
	if (!quote?.outAmount) throw clientError('no_route', 'No swap route found for this pair and amount', 422);

	let swapB64;
	try {
		swapB64 = await jupiterSwapTx({ quote, userPublicKey: sender, wrapAndUnwrapSol: true });
	} catch (err) {
		if (err?.status >= 400 && err.status < 500) throw clientError('swap_failed', 'The router could not build a transaction for this route', 422);
		throw upstreamError(`swap build failed upstream: ${err?.message || 'network error'}`);
	}
	const transaction = VersionedTransaction.deserialize(Buffer.from(swapB64, 'base64'));
	let lastValidBlockHeight = null;
	try {
		lastValidBlockHeight = (await connection.getLatestBlockhash('confirmed')).lastValidBlockHeight;
	} catch {
		lastValidBlockHeight = null;
	}
	return {
		transaction,
		blockhash: transaction.message.recentBlockhash,
		lastValidBlockHeight,
		summary: {
			action: 'swap',
			asset: inputMint,
			decimals: inDecimals,
			amount_raw: raw.toString(),
			amount: Number(amount),
			output_mint: outputMint,
			output_decimals: outDecimals,
			expected_out_raw: String(quote.outAmount),
			expected_out: Number(quote.outAmount) / 10 ** outDecimals,
			min_out_raw: quote.otherAmountThreshold != null ? String(quote.otherAmountThreshold) : null,
			price_impact_pct: quote.priceImpactPct != null ? Number(quote.priceImpactPct) : null,
			slippage_bps: slippageBps,
			from: sender,
			network: 'mainnet',
		},
	};
}
