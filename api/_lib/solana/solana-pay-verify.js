// Solana Pay verification (locate a payment by its reference key, then assert
// the transfer) over the platform's failover RPC lanes.
//
// @solana/pay 1.x is built on @solana/kit: it reads through a kit `Rpc`, takes
// kit `Address` strings and a plain-number UI amount. Every payment flow here
// holds web3.js PublicKeys and BigNumber amounts, so this module converts at
// that one boundary and the callers stay on their existing types.
//
// validateTransfer inspects only the LAST instruction of the transaction for
// the transfer and its reference keys (and the one before it for a memo), so
// every builder that wants a payment found must put the reference-bound leg
// last. See api/_lib/solana/gasless-tx.js and api/purchase/skill.js.
//
// Two gaps in @solana/pay 1.0.26 are closed here rather than worked around in
// every caller:
//
// 1. A payment that opens the recipient's token account in the same
//    transaction (an idempotent ATA create ahead of the transfer, which every
//    builder here emits for a first-time seller or treasury) has no
//    preTokenBalances entry for that account, and pay rejects it with
//    'missing balance data'. pay throws that only after it has checked the
//    program, the destination ATA, the mint and the references, so the
//    fallback below only has to prove the amount: the account must be absent
//    before, present after with the right mint, and hold at least the price.
// 2. pay compares the memo program to MEMO_PROGRAM_ADDRESS from
//    @solana-program/memo, which 0.16 moved to the v4 program. Wallets write
//    memos with the v3 program (MemoSq4...), so pay's own memo check refused
//    every real memo. The memo is checked here against all supported Memo
//    program versions instead, and never passed to pay.

import {
	address,
	decompileTransactionMessage,
	getBase64Codec,
	getCompiledTransactionMessageCodec,
	getTransactionCodec,
	signature as toSignature,
} from '@solana/kit';
import { SUPPORTED_MEMO_PROGRAM_ADDRESSES } from '@solana-program/memo';
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';
import {
	findReference as payFindReference,
	validateTransfer as payValidateTransfer,
	FindReferenceError,
	ValidateTransferError,
} from '@solana/pay';
import { solanaKitRpc } from './kit-rpc.js';

export { FindReferenceError, ValidateTransferError };

const toAddress = (value) => address(typeof value === 'string' ? value : value.toBase58());

// validateTransfer converts the UI amount to base units with toFixed(decimals),
// which is exact for any amount a payment flow prices (pay itself rejects more
// than 15 significant digits rather than rounding silently).
function toUiAmount(amount) {
	const n = typeof amount === 'number' ? amount : Number(amount.toString());
	if (!Number.isFinite(n) || n < 0) throw new ValidateTransferError('amount invalid');
	return n;
}

// Same conversion pay applies (toFixed, then refuse float precision loss).
function toBaseUnits(amount, decimals) {
	const [whole, frac = ''] = amount.toFixed(decimals).split('.');
	const significant = whole.replace(/^0+/, '').length + frac.replace(/0+$/, '').length;
	if (significant > 15) throw new ValidateTransferError('amount invalid');
	return BigInt(whole + frac);
}

function decodeTransaction(response) {
	const [base64] = response.transaction;
	const tx = getTransactionCodec().decode(getBase64Codec().encode(base64));
	const compiled = getCompiledTransactionMessageCodec().decode(tx.messageBytes);
	return {
		instructions: [...decompileTransactionMessage(compiled).instructions],
		staticAccounts: compiled.staticAccounts,
	};
}

// One getTransaction per validation: pay reads through this wrapper and the
// fallbacks below reuse the same response.
function cachingRpc(rpc) {
	let pending = null;
	return {
		getTransaction: (...args) => ({
			send: () => (pending ??= rpc.getTransaction(...args).send()),
		}),
		fetched: () => pending,
	};
}

const TOKEN_PROGRAMS = [TOKEN_PROGRAM_ADDRESS, TOKEN_2022_PROGRAM_ADDRESS];

// The recipient token account was opened by this transaction. pay has already
// validated the transfer instruction's program, destination, mint and
// references before it gave up on the missing pre balance.
async function validateOpenedAccount(response, { recipient, splToken, amount }, original) {
	const { instructions, staticAccounts } = decodeTransaction(response);
	const transfer = instructions.at(-1);
	if (!transfer || !TOKEN_PROGRAMS.includes(transfer.programAddress)) throw original;
	const [ata] = await findAssociatedTokenPda({ owner: recipient, mint: splToken, tokenProgram: transfer.programAddress });
	const index = staticAccounts.indexOf(ata);
	if (index === -1) throw original;
	const pre = response.meta?.preTokenBalances?.find((b) => b.accountIndex === index);
	const post = response.meta?.postTokenBalances?.find((b) => b.accountIndex === index);
	if (pre || !post || post.mint !== splToken) throw original;
	const { amount: received, decimals } = post.uiTokenAmount;
	if (BigInt(received) < toBaseUnits(amount, decimals)) throw new ValidateTransferError('amount not transferred');
}

function validateMemo(response, memo) {
	const { instructions } = decodeTransaction(response);
	const memoIx = instructions.at(-2);
	if (!memoIx) throw new ValidateTransferError('missing memo instruction');
	if (!SUPPORTED_MEMO_PROGRAM_ADDRESSES.includes(memoIx.programAddress)) {
		throw new ValidateTransferError('invalid memo program');
	}
	if (!memoIx.data || new TextDecoder().decode(memoIx.data) !== memo) throw new ValidateTransferError('invalid memo');
}

/**
 * Oldest transaction signature that carries `reference`.
 * @param {import('@solana/web3.js').PublicKey | string} reference
 * @param {{ network?: 'mainnet'|'devnet', commitment?: 'confirmed'|'finalized' }} [opts]
 * @returns {Promise<{ signature: string, slot: bigint|number, err: unknown }>}
 * @throws {FindReferenceError} when no transaction references the key yet
 */
export async function findReference(reference, { network = 'mainnet', commitment = 'confirmed' } = {}) {
	return payFindReference(solanaKitRpc(network), toAddress(reference), { commitment });
}

/**
 * Assert that `signature` is a Solana Pay transfer of at least `amount` (UI
 * units) to `recipient`, optionally in `splToken`, bound to `reference`.
 * @param {string} signature
 * @param {{
 *   recipient: import('@solana/web3.js').PublicKey | string,
 *   amount: number | string | { toString(): string },
 *   splToken?: import('@solana/web3.js').PublicKey | string,
 *   reference?: import('@solana/web3.js').PublicKey | string | Array<import('@solana/web3.js').PublicKey | string>,
 *   memo?: string,
 * }} fields
 * @param {{ network?: 'mainnet'|'devnet', commitment?: 'confirmed'|'finalized' }} [opts]
 * @throws {ValidateTransferError} when the transaction does not satisfy `fields`
 */
export async function validateTransfer(
	signature,
	{ recipient, amount, splToken, reference, memo },
	{ network = 'mainnet', commitment = 'confirmed' } = {},
) {
	const fields = { recipient: toAddress(recipient), amount: toUiAmount(amount) };
	if (splToken) fields.splToken = toAddress(splToken);
	if (reference) fields.reference = Array.isArray(reference) ? reference.map(toAddress) : toAddress(reference);
	const rpc = cachingRpc(solanaKitRpc(network));
	let response;
	try {
		response = await payValidateTransfer(rpc, toSignature(signature), fields, { commitment });
	} catch (err) {
		if (!(fields.splToken && err?.message === 'missing balance data')) throw err;
		response = await rpc.fetched();
		await validateOpenedAccount(response, fields, err);
	}
	if (memo !== undefined) validateMemo(response, memo);
	return response;
}
