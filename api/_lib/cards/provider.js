// Card provider adapter contract.
//
// Every gift-card or prepaid-card issuer the platform integrates is one adapter
// module that returns an object with exactly these methods. The card service
// (api/_lib/cards/service.js) talks only to this contract, so adding a second
// issuer is one new file plus one line in PROVIDERS below.
//
// Adapters never persist anything and never touch an agent wallet: they turn
// provider HTTP into normalized shapes. Settlement, spend limits, the audit
// trail and secret encryption all live in the service.
//
// Normalized card statuses an adapter may report:
//   awaiting_payment  the provider invoice exists and is unpaid
//   processing        paid, being fulfilled
//   delivered         redemption data is available
//   failed            fulfillment failed permanently
//   refunded          the provider returned the payment
//   needs_verification  the provider wants the account holder to complete
//                       identity steps (see connectLink)

import { createBitrefillProvider } from './bitrefill.js';

export const PROVIDER_METHODS = Object.freeze([
	'searchMerchants',
	'searchProducts',
	'getProduct',
	'quote',
	'create',
	'status',
	'cardData',
	'balance',
	'reveal',
	'cancel',
	'refresh',
	'withdraw',
	'connectLink',
]);

export const CARD_STATUSES = Object.freeze([
	'awaiting_payment', 'processing', 'delivered', 'failed', 'refunded', 'needs_verification',
]);

/**
 * A provider-side failure with a machine-readable code and an HTTP-ish status,
 * so the REST and MCP boundaries can surface it verbatim.
 *   unsupported        the provider has no such capability (withdraw, balance)
 *   not_configured     the provider credential is missing
 *   invalid_amount     the value is not a package or is outside the range
 *   not_found          unknown product / order
 *   out_of_stock       product unavailable right now
 *   rate_limited       provider throttled us
 *   upstream           any other provider failure
 */
export class CardProviderError extends Error {
	constructor(code, message, { status, detail } = {}) {
		super(message);
		this.name = 'CardProviderError';
		this.code = code;
		this.status = status ?? STATUS_BY_CODE[code] ?? 502;
		this.detail = detail || {};
	}
}

const STATUS_BY_CODE = {
	unsupported: 409,
	not_configured: 503,
	invalid_amount: 400,
	not_found: 404,
	out_of_stock: 409,
	rate_limited: 429,
	upstream: 502,
};

/** Throws when an adapter object is missing part of the contract. */
export function assertProvider(adapter) {
	if (!adapter || typeof adapter !== 'object') throw new TypeError('card provider must be an object');
	if (typeof adapter.name !== 'string' || !adapter.name) throw new TypeError('card provider needs a name');
	if (!adapter.capabilities || typeof adapter.capabilities !== 'object') {
		throw new TypeError(`card provider ${adapter.name} needs a capabilities object`);
	}
	for (const m of PROVIDER_METHODS) {
		if (typeof adapter[m] !== 'function') throw new TypeError(`card provider ${adapter.name} is missing ${m}()`);
	}
	return adapter;
}

const PROVIDERS = {
	bitrefill: createBitrefillProvider,
};

export const DEFAULT_PROVIDER = 'bitrefill';

const cache = new Map();

/**
 * The adapter for `name` (default provider when omitted). Instances are cached
 * per process; pass `opts` (tests) to build a fresh, uncached one.
 */
export function getCardProvider(name = DEFAULT_PROVIDER, opts = null) {
	const factory = Object.hasOwn(PROVIDERS, name) ? PROVIDERS[name] : null;
	if (!factory) throw new CardProviderError('not_found', `unknown card provider: ${name}`);
	if (opts) return assertProvider(factory(opts));
	if (!cache.has(name)) cache.set(name, assertProvider(factory()));
	return cache.get(name);
}

export function listCardProviders() {
	return Object.keys(PROVIDERS);
}
