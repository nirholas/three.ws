// Robinhood Crypto Trading API client (crypto pairs only, e.g. BTC-USD).
//
// Authentication is the documented scheme: every request carries
//   x-api-key    the API key credential the owner created in Robinhood
//   x-timestamp  unix seconds (the API accepts a 30 second window)
//   x-signature  base64 Ed25519 signature over
//                api_key + timestamp + path(with query) + METHOD + body
// The owner generates the Ed25519 key pair themselves and registers the PUBLIC
// half with Robinhood. We hold the private seed only inside secret-box.
//
// This module is transport only. Spend limits live in spend-caps.js and are
// enforced by service.js before any order reaches placeOrder, and placeOrder
// re-checks the per-order ceiling it is handed before it opens a socket.
// Credentials never appear in a thrown error, a log line or a return value.

import { createPrivateKey, createPublicKey, randomUUID, sign as edSign } from 'node:crypto';

export const BASE_URL = 'https://trading.robinhood.com';
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const SYMBOL_RE = /^[A-Z0-9]{2,10}-USD$/;
const DECIMAL_RE = /^\d+(\.\d{1,18})?$/;
const TIMEOUT_MS = 10_000;
const RETRY_STATUSES = new Set([429, 502, 503, 504]);

export class RobinhoodApiError extends Error {
	constructor(code, message, status = null) {
		super(message);
		this.name = 'RobinhoodApiError';
		this.code = code;
		this.status = status;
		this.expose = true;
	}
}

export const isCryptoSymbol = (s) => typeof s === 'string' && SYMBOL_RE.test(s);

/** Decode the owner's base64 private key (32 byte seed, or 64 byte seed+public) into a KeyObject. */
export function privateKeyFromBase64(b64) {
	const raw = Buffer.from(String(b64 || '').trim(), 'base64');
	if (raw.length !== 32 && raw.length !== 64) {
		throw new RobinhoodApiError('bad_private_key', 'The private key must be the base64 Ed25519 key from your Robinhood key pair (32 bytes).');
	}
	return createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, raw.subarray(0, 32)]), format: 'der', type: 'pkcs8' });
}

/** Base64 of the 32 byte public key matching a private key, to show the owner which key to register. */
export function publicKeyBase64(privateKey) {
	const jwk = createPublicKey(privateKey).export({ format: 'jwk' });
	return Buffer.from(jwk.x, 'base64url').toString('base64');
}

/** The exact string Robinhood verifies the signature against. */
export function signingMessage({ apiKey, timestamp, path, method, body = '' }) {
	return `${apiKey}${timestamp}${path}${String(method).toUpperCase()}${body}`;
}

/** Build the three auth headers for one request. */
export function signRequest({ apiKey, privateKey, method, path, body = '', timestamp = Math.floor(Date.now() / 1000) }) {
	const key = typeof privateKey === 'string' ? privateKeyFromBase64(privateKey) : privateKey;
	const signature = edSign(null, Buffer.from(signingMessage({ apiKey, timestamp, path, method, body })), key).toString('base64');
	return { 'x-api-key': apiKey, 'x-timestamp': String(timestamp), 'x-signature': signature };
}

function decimal(value, label) {
	const s = typeof value === 'number' ? String(value) : String(value ?? '').trim();
	if (!DECIMAL_RE.test(s) || Number(s) <= 0) throw new RobinhoodApiError('bad_request', `${label} must be a positive decimal number.`);
	return s;
}

function describe(status, payload) {
	const detail =
		payload?.errors?.[0]?.detail || payload?.detail || payload?.message || payload?.error || null;
	return typeof detail === 'string' ? detail.slice(0, 300) : `Robinhood returned HTTP ${status}.`;
}

/**
 * @param {{ apiKey: string, privateKey: string, fetchImpl?: typeof fetch, now?: () => number, sleep?: (ms: number) => Promise<void> }} cfg
 */
export function createCryptoClient({ apiKey, privateKey, fetchImpl = globalThis.fetch, now = () => Math.floor(Date.now() / 1000), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
	if (!apiKey || typeof apiKey !== 'string') throw new RobinhoodApiError('bad_api_key', 'An API key is required.');
	const key = typeof privateKey === 'string' ? privateKeyFromBase64(privateKey) : privateKey;

	async function request(method, path, payload) {
		const body = payload === undefined ? '' : JSON.stringify(payload);
		const idempotent = method === 'GET';
		for (let attempt = 0; ; attempt++) {
			const headers = { ...signRequest({ apiKey, privateKey: key, method, path, body, timestamp: now() }), accept: 'application/json' };
			if (body) headers['content-type'] = 'application/json';
			let res;
			try {
				res = await fetchImpl(`${BASE_URL}${path}`, { method, headers, body: body || undefined, signal: AbortSignal.timeout(TIMEOUT_MS) });
			} catch {
				if (idempotent && attempt < 2) { await sleep(400 * 2 ** attempt); continue; }
				throw new RobinhoodApiError('upstream_unreachable', 'Robinhood did not respond. Try again in a moment.', 502);
			}
			if (idempotent && RETRY_STATUSES.has(res.status) && attempt < 2) {
				await sleep(400 * 2 ** attempt);
				continue;
			}
			const data = await res.json().catch(() => ({}));
			if (res.ok) return data;
			if (res.status === 401 || res.status === 403) {
				throw new RobinhoodApiError('credentials_rejected', 'Robinhood rejected the API key or signature. Check that the public key you registered matches this private key.', res.status);
			}
			if (res.status === 429) throw new RobinhoodApiError('rate_limited', 'Robinhood is rate limiting this key. Wait a minute and retry.', 429);
			throw new RobinhoodApiError(res.status === 400 ? 'order_rejected' : 'upstream_error', describe(res.status, data), res.status);
		}
	}

	const sym = (symbol) => {
		if (!isCryptoSymbol(symbol)) throw new RobinhoodApiError('bad_request', 'symbol must be a crypto pair such as BTC-USD.');
		return symbol;
	};

	return {
		getAccount: () => request('GET', '/api/v1/crypto/trading/accounts/'),
		async holdings() {
			const out = [];
			let path = '/api/v1/crypto/trading/holdings/';
			for (let page = 0; page < 10 && path; page++) {
				const r = await request('GET', path);
				out.push(...(r.results || []));
				path = r.next ? new URL(r.next).pathname + new URL(r.next).search : null;
			}
			return out;
		},
		async bestBidAsk(symbol) {
			const r = await request('GET', `/api/v1/crypto/marketdata/best_bid_ask/?symbol=${encodeURIComponent(sym(symbol))}`);
			return (r.results || [])[0] || null;
		},
		async estimatedPrice(symbol, side, quantity) {
			if (side !== 'bid' && side !== 'ask') throw new RobinhoodApiError('bad_request', 'side must be bid or ask.');
			const r = await request('GET', `/api/v1/crypto/marketdata/estimated_price/?symbol=${encodeURIComponent(sym(symbol))}&side=${side}&quantity=${decimal(quantity, 'quantity')}`);
			return (r.results || [])[0] || null;
		},
		async tradingPair(symbol) {
			const r = await request('GET', `/api/v1/crypto/trading/trading_pairs/?symbol=${encodeURIComponent(sym(symbol))}`);
			return (r.results || [])[0] || null;
		},
		/**
		 * Place one order. `notionalUsd` is the caller's estimate of the order value and
		 * `maxNotionalUsd` the ceiling it must stay under: an order above it throws
		 * before any request is built.
		 */
		async placeOrder({ symbol, side, type = 'market', quantity, limitPrice, timeInForce = 'gtc', clientOrderId = randomUUID(), notionalUsd, maxNotionalUsd }) {
			sym(symbol);
			if (side !== 'buy' && side !== 'sell') throw new RobinhoodApiError('bad_request', 'side must be buy or sell.');
			if (type !== 'market' && type !== 'limit') throw new RobinhoodApiError('bad_request', 'type must be market or limit.');
			if (!Number.isFinite(notionalUsd) || !Number.isFinite(maxNotionalUsd)) {
				throw new RobinhoodApiError('cap_required', 'An order needs a notional estimate and a cap ceiling.');
			}
			if (notionalUsd > maxNotionalUsd) {
				throw new RobinhoodApiError('over_cap', `This order is about $${notionalUsd.toFixed(2)}, above the $${maxNotionalUsd.toFixed(2)} limit.`);
			}
			const order = { client_order_id: clientOrderId, side, type, symbol };
			if (type === 'market') order.market_order_config = { asset_quantity: decimal(quantity, 'quantity') };
			else order.limit_order_config = { asset_quantity: decimal(quantity, 'quantity'), limit_price: decimal(limitPrice, 'limit price'), time_in_force: timeInForce };
			return request('POST', '/api/v1/crypto/trading/orders/', order);
		},
		getOrder: (id) => request('GET', `/api/v1/crypto/trading/orders/${encodeURIComponent(id)}/`),
		cancelOrder: (id) => request('POST', `/api/v1/crypto/trading/orders/${encodeURIComponent(id)}/cancel/`),
	};
}
