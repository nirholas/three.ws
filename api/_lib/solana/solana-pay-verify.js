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

import { address, signature as toSignature } from '@solana/kit';
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
	if (memo !== undefined) fields.memo = memo;
	return payValidateTransfer(solanaKitRpc(network), toSignature(signature), fields, { commitment });
}
