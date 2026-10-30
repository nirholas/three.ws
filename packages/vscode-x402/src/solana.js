// Solana x402 payer for the extension.
//
// Ports the real `@x402/svm` `exact`-scheme buyer used by @three-ws/x402-mcp so
// the extension can pay Solana services in USDC OR $THREE from a local keypair.
// Nothing is mocked: the 402 dance, the SPL transfer, and the settlement are all
// handled by the real `@x402/*` libraries. $THREE is the three.ws platform token
// on Solana, so paying it is just selecting that advertised `accept`.

import bs58 from 'bs58';

// Solana mainnet-beta CAIP-2 network id.
export const SOLANA_MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

// $THREE — the three.ws platform token (Solana SPL).
export const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

// Canonical USDC mints we recognise (Solana + Base, lowercased for EVM).
const USDC_MINTS = new Set([
	'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // Solana
	'0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // Base
]);

export function isSolanaNetwork(net) {
	return typeof net === 'string' && net.startsWith('solana:');
}

/** A Solana `exact`-scheme accept this signer can settle. */
export function isSolanaExactAccept(a) {
	return !!a && isSolanaNetwork(a.network) && (!a.scheme || a.scheme === 'exact');
}

/** True when an `accepts[]` entry settles in $THREE (by token name or mint). */
export function isThreeAccept(a) {
	const name = String(a?.extra?.name || '').trim().toUpperCase();
	return name === 'THREE' || String(a?.asset || '') === THREE_MINT;
}

/** True when an `accepts[]` entry settles in USDC (by token name or mint). */
export function isUsdcAccept(a) {
	const name = String(a?.extra?.name || '').trim().toUpperCase().replace('USD COIN', 'USDC');
	return name === 'USDC' || USDC_MINTS.has(String(a?.asset || '').toLowerCase());
}

/** Human token label for a requirement ($THREE / USDC / declared name). */
export function tokenLabel(a) {
	if (isThreeAccept(a)) return '$THREE';
	if (isUsdcAccept(a)) return 'USDC';
	const n = String(a?.extra?.name || '').trim();
	return n || 'token';
}

/**
 * Human-readable amount of a non-USDC requirement in whole tokens, from the
 * atomic `amount` and the declared `extra.decimals` (6 when undeclared).
 * Display only: spend caps use `amountToUsd`, which prices anything off the
 * pinned USDC assets as Infinity.
 */
export function tokenAmountOf(a) {
	const atomic = Number(a?.amount);
	const declared = Number(a?.extra?.decimals);
	const decimals = Number.isInteger(declared) && declared >= 0 && declared <= 18 ? declared : 6;
	return Number.isFinite(atomic) && atomic >= 0 ? atomic / 10 ** decimals : Infinity;
}

/** Narrow accepts to a preferred token; fail-open so a payment still settles. */
function filterAcceptsByToken(accepts, token) {
	if (!Array.isArray(accepts) || !token || token === 'auto') return Array.isArray(accepts) ? accepts : [];
	const want = String(token).toLowerCase();
	const matches = accepts.filter((a) => (want === 'three' ? isThreeAccept(a) : want === 'usdc' ? isUsdcAccept(a) : true));
	return matches.length ? matches : accepts;
}

// A fetch that rewrites a 402 challenge's `accepts` down to the preferred token
// BEFORE the payment layer reads it, so the exact scheme signs that asset.
function makeTokenFilteringFetch(token) {
	return async (input, init) => {
		const res = await globalThis.fetch(input, init);
		if (res.status !== 402) return res;
		let body;
		try {
			body = await res.clone().json();
		} catch {
			return res;
		}
		if (!body || !Array.isArray(body.accepts)) return res;
		const filtered = filterAcceptsByToken(body.accepts, token);
		if (filtered === body.accepts || filtered.length === body.accepts.length) return res;
		body.accepts = filtered;
		const headers = new Headers(res.headers);
		headers.delete('content-length');
		return new Response(JSON.stringify(body), { status: 402, statusText: res.statusText, headers });
	};
}

/** base58 string OR JSON byte array → raw secret-key bytes. Throws on bad input. */
export function solanaSecretBytes(secret) {
	const s = String(secret || '').trim();
	if (!s) throw new Error('No Solana signer configured.');
	if (s.startsWith('[')) {
		let arr;
		try {
			arr = JSON.parse(s);
		} catch {
			throw new Error('Solana key looks like a JSON array but failed to parse.');
		}
		return Uint8Array.from(arr);
	}
	try {
		return bs58.decode(s);
	} catch {
		throw new Error('Solana key must be a base58 string or a JSON byte array.');
	}
}

/** Validate a Solana secret and return its base58 address (throws if invalid). */
export async function solanaAddressFromSecret(secret) {
	const { createKeyPairSignerFromBytes } = await import('@solana/kit');
	const signer = await createKeyPairSignerFromBytes(solanaSecretBytes(secret));
	return String(signer.address);
}

/**
 * Build a payment-aware fetch bound to a Solana keypair, settling the `exact`
 * SVM scheme. `preferToken` ('usdc' | 'three' | 'auto') narrows which advertised
 * accept is paid before the payment layer selects one.
 *
 * @param {string} secret base58 secret key or JSON byte array
 * @param {{ preferToken?: 'usdc'|'three'|'auto' }} [opts]
 * @returns {Promise<{ payingFetch: typeof fetch, address: string }>}
 */
export async function buildSolanaPayingFetch(secret, opts = {}) {
	const [{ x402Client }, { ExactSvmScheme }, { wrapFetchWithPayment }, { createKeyPairSignerFromBytes }] =
		await Promise.all([
			import('@x402/core/client'),
			import('@x402/svm/exact/client'),
			import('@x402/fetch'),
			import('@solana/kit'),
		]);
	const signer = await createKeyPairSignerFromBytes(solanaSecretBytes(secret));
	const client = new x402Client();
	client.register('solana:*', new ExactSvmScheme(signer));
	const base = opts.preferToken && opts.preferToken !== 'auto' ? makeTokenFilteringFetch(opts.preferToken) : globalThis.fetch;
	const payingFetch = wrapFetchWithPayment(base, client);
	return { payingFetch, address: String(signer.address) };
}
