// x402 buyer wiring — pay any x402 endpoint from a local Solana keypair.
//
// Mirrors the canonical three.ws buyer (api/_lib/x402-user-payer.js) but for a
// self-custodial standalone: the signer is YOUR key (SOLANA_SECRET_KEY or a
// per-call `secret`), not a custodial wallet. Real `@x402/*` libraries do the
// 402 dance and sign the Solana `exact`-scheme payment — nothing is mocked.
//
// The flow:
//   1. x402Client + registerExactSvmScheme(client, { signer }) registers BOTH
//      wire formats: v2's CAIP-2 `solana:*` wildcard and v1's flat network
//      strings (`solana`, `solana-devnet`, `solana-testnet`), the format
//      most of the open x402 bazaar and the owner's x402-suite still speak.
//   2. wrapFetchWithPayment(fetch, client) → a fetch that, on a 402, signs and
//      retries with the X-PAYMENT header, then exposes the settlement response.
//      @x402/core prefers the v2 `PAYMENT-REQUIRED` header over a v1-shaped
//      body whenever a seller advertises both.

import bs58 from 'bs58';

import { SOLANA_DEFAULT_SECRET } from '../config.js';

// The two main x402 assets. $THREE is the three.ws platform token (Solana SPL);
// USDC is canonical on Solana + Base. Used to pick which advertised accept to
// settle when the caller prefers a specific token.
const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const USDC_MINTS = new Set([
	'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // Solana
	'0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // Base (lowercased)
]);

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

/**
 * Narrow an `accepts[]` to the caller's preferred token ('usdc' | 'three').
 * Fail-open: if nothing matches the preference, the original list is returned so
 * a payment still settles rather than dead-ending.
 */
export function filterAcceptsByToken(accepts, token) {
	if (!Array.isArray(accepts) || !token) return Array.isArray(accepts) ? accepts : [];
	const want = String(token).toLowerCase();
	const matches = accepts.filter((a) => (want === 'three' ? isThreeAccept(a) : want === 'usdc' ? isUsdcAccept(a) : true));
	return matches.length ? matches : accepts;
}

// A fetch that rewrites a 402 challenge's `accepts` down to the preferred token
// BEFORE the payment layer reads it, so wrapFetchWithPayment selects + signs
// that asset. Non-402 responses pass straight through.
function makeTokenFilteringFetch(token) {
	return async (input, init) => {
		const res = await globalThis.fetch(input, init);
		if (res.status !== 402) return res;
		let body;
		try {
			body = await res.clone().json();
		} catch {
			return res; // not JSON — let the default flow handle it
		}
		if (!body || !Array.isArray(body.accepts)) return res;
		const filtered = filterAcceptsByToken(body.accepts, token);
		if (filtered === body.accepts || filtered.length === body.accepts.length) return res;
		body.accepts = filtered;
		const headers = new Headers(res.headers);
		headers.delete('content-length'); // body changed
		return new Response(JSON.stringify(body), { status: 402, statusText: res.statusText, headers });
	};
}

/** Decode a base58 string OR a JSON byte array into raw secret-key bytes. */
function secretKeyBytes(secret) {
	const s = String(secret || '').trim();
	if (!s) {
		throw Object.assign(new Error('No Solana signer configured. Set SOLANA_SECRET_KEY or pass `secret`.'), {
			code: 'no_signer',
		});
	}
	if (s.startsWith('[')) {
		let arr;
		try {
			arr = JSON.parse(s);
		} catch {
			throw Object.assign(new Error('SOLANA_SECRET_KEY looks like a JSON array but failed to parse.'), {
				code: 'bad_secret',
			});
		}
		return Uint8Array.from(arr);
	}
	try {
		return bs58.decode(s);
	} catch {
		throw Object.assign(new Error('SOLANA_SECRET_KEY must be a base58 string or a JSON byte array.'), {
			code: 'bad_secret',
		});
	}
}

/**
 * Build a Solana signer (from @solana/kit) for the given secret. Returns the
 * kit signer (its `.address` is the base58 pubkey).
 */
export async function getSigner(secretOverride) {
	const { createKeyPairSignerFromBytes } = await import('@solana/kit');
	const bytes = secretKeyBytes(secretOverride || SOLANA_DEFAULT_SECRET);
	return createKeyPairSignerFromBytes(bytes);
}

/**
 * Build a payment-aware fetch bound to a Solana signer. The returned `payingFetch`
 * behaves like global fetch but transparently settles a 402 challenge — in USDC
 * by default, or in $THREE when `preferToken: 'three'` is passed (the endpoint
 * must advertise that asset). The `exact` SVM scheme signs whichever asset the
 * selected accept names, so token choice is just accept selection.
 *
 * @param {string} [secretOverride]
 * @param {{ preferToken?: 'usdc' | 'three' }} [opts]
 * @returns {Promise<{ payingFetch: typeof fetch, httpClient: any, address: string }>}
 */
export async function buildPayingFetch(secretOverride, opts = {}) {
	const [{ x402Client, x402HTTPClient }, { registerExactSvmScheme }, { wrapFetchWithPayment }] = await Promise.all([
		import('@x402/core/client'),
		import('@x402/svm/exact/client'),
		import('@x402/fetch'),
	]);
	const signer = await getSigner(secretOverride);
	const client = new x402Client();
	registerExactSvmScheme(client, { signer });
	const httpClient = new x402HTTPClient(client);
	const baseFetch = opts.preferToken ? makeTokenFilteringFetch(opts.preferToken) : globalThis.fetch;
	const payingFetch = wrapFetchWithPayment(baseFetch, client);
	return { payingFetch, httpClient, address: String(signer.address) };
}

/** Decode the settlement receipt from a paid response's `x-payment-response` header. */
export async function decodeSettlement(response) {
	const header = response?.headers?.get?.('x-payment-response');
	if (!header) return null;
	try {
		const { decodePaymentResponseHeader } = await import('@x402/fetch');
		return decodePaymentResponseHeader(header);
	} catch {
		try {
			return JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
		} catch {
			return null;
		}
	}
}

/**
 * Fetch an x402 endpoint WITHOUT paying and return its 402 challenge (the
 * `accepts` payment requirements) decoded, or the plain result if it's free.
 */
export async function probeChallenge(url, { method = 'GET', body, timeoutMs = 30000 } = {}) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	let res;
	try {
		res = await fetch(url, {
			method,
			headers: {
				accept: 'application/json',
				...(body !== undefined ? { 'content-type': 'application/json' } : {}),
			},
			body: body !== undefined ? JSON.stringify(body) : undefined,
			signal: controller.signal,
		});
	} catch (err) {
		clearTimeout(timer);
		if (err?.name === 'AbortError') throw Object.assign(new Error(`${url} timed out`), { code: 'timeout' });
		throw Object.assign(new Error(`${url} request failed: ${err?.message || err}`), { code: 'network_error' });
	}
	clearTimeout(timer);
	const text = await res.text();
	let parsed;
	try {
		parsed = text ? JSON.parse(text) : null;
	} catch {
		parsed = text;
	}
	if (res.status !== 402) {
		return { paid: false, status: res.status, ok: res.ok, result: parsed };
	}
	const accepts = Array.isArray(parsed?.accepts) ? parsed.accepts : [];
	return { paid: true, status: 402, accepts, challenge: parsed };
}
