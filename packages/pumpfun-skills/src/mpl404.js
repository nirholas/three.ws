// MPL-404 (often called SPL-404) planning helpers for Pump.fun mints.
//
// Pump.fun creates the fungible side of a hybrid.  The maintained hybrid
// program then escrows that SPL mint against Metaplex Core NFTs.  It is not a
// different Pump.fun launch mode and must never be represented as one: a
// project needs both a real SPL mint and a Core collection before it can swap.

export const MPL_HYBRID_PROGRAM_ID = 'MPL4o4wMzndgh8T1NVDxELQCj5UQfYTYEkabX3wNKtb';
export const MPL_HYBRID_INSTRUCTION_VERSION = 'V1';
export const MPL_HYBRID_ASSET_STANDARD = 'metaplex-core';
export const MPL_HYBRID_DOCS_URL = 'https://www.metaplex.com/docs/smart-contracts/mpl-hybrid';

const PUBKEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function inputError(message) {
	const err = new Error(message);
	err.code = 'invalid_hybrid_input';
	return err;
}

function publicKey(value, label) {
	if (typeof value !== 'string' || !PUBKEY.test(value)) {
		throw inputError(`${label} must be a base58 Solana public key`);
	}
	return value;
}

function uint(value, label, { min = 0n, max = (1n << 64n) - 1n } = {}) {
	let parsed;
	try {
		parsed = typeof value === 'bigint' ? value : BigInt(value);
	} catch {
		throw inputError(`${label} must be an unsigned integer`);
	}
	if (parsed < min || parsed > max) throw inputError(`${label} is out of range`);
	return parsed;
}

/**
 * Validate and describe the V1 MPL-Hybrid setup that makes a Pump.fun mint a
 * hybrid backing token. This function deliberately does not broadcast or
 * custody a key: callers use the returned values to build the upstream V1
 * `initEscrowV1` transaction with their own wallet signer.
 *
 * `amount` is the number of smallest fungible units required to release one
 * Core asset. `min` and `max` are passed through to the upstream V1 escrow
 * instruction and are constrained around that amount to avoid an accidental,
 * surprising exchange configuration.
 */
export function createMpl404Plan(input = {}) {
	const tokenMint = publicKey(input.tokenMint, 'tokenMint');
	const collection = publicKey(input.collection, 'collection');
	const authority = publicKey(input.authority, 'authority');
	const feeLocation = publicKey(input.feeLocation || authority, 'feeLocation');
	const amount = uint(input.amount, 'amount', { min: 1n });
	const min = uint(input.min ?? amount, 'min');
	const max = uint(input.max ?? amount, 'max');
	const feeAmount = uint(input.feeAmount ?? 0, 'feeAmount');
	const solFeeAmount = uint(input.solFeeAmount ?? 0, 'solFeeAmount');
	const path = uint(input.path ?? 0, 'path', { max: 65535n });
	const name = String(input.name || '').trim();
	const uri = String(input.uri || '').trim();

	if (!name || name.length > 32) throw inputError('name must be 1-32 characters');
	if (!/^https?:\/\//.test(uri) || uri.length > 200) {
		throw inputError('uri must be an https metadata URL no longer than 200 characters');
	}
	if (min > amount || amount > max) {
		throw inputError('min <= amount <= max is required for a predictable swap ratio');
	}

	return Object.freeze({
		standard: 'mpl-404',
		instructionVersion: MPL_HYBRID_INSTRUCTION_VERSION,
		programId: MPL_HYBRID_PROGRAM_ID,
		assetStandard: MPL_HYBRID_ASSET_STANDARD,
		backing: { kind: 'spl-fungible-token', mint: tokenMint },
		collection,
		authority,
		feeLocation,
		initEscrowV1: {
			name,
			uri,
			max: max.toString(),
			min: min.toString(),
			amount: amount.toString(),
			feeAmount: feeAmount.toString(),
			solFeeAmount: solFeeAmount.toString(),
			path: Number(path),
		},
		// Swap protocol fees are controlled by the deployed program. Do not bake a
		// stale fee number into a product quote; fetch/confirm it at signing time.
		feeNotice: 'MPL-Hybrid protocol fees may apply. Confirm the current fee before signing.',
		docsUrl: MPL_HYBRID_DOCS_URL,
		requiredTransactions: ['initEscrowV1', 'captureV1', 'releaseV1'],
	});
}

/** True only for the supported, production-compatible pairing. */
export function isMpl404Compatible(input = {}) {
	return input.assetStandard === MPL_HYBRID_ASSET_STANDARD &&
		typeof input.tokenMint === 'string' && PUBKEY.test(input.tokenMint);
}
