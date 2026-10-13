// Thin Admin GraphQL client. Every Shopify call in this app (products,
// staged uploads, productCreateMedia, billing, webhook registration) goes
// through here so retries, error shaping, and the endpoint URL live in one
// place.

import { ADMIN_API_VERSION } from './config.js';

const TIMEOUT_MS = 20_000;

export class ShopifyApiError extends Error {
	constructor(message, { status, userErrors } = {}) {
		super(message);
		this.name = 'ShopifyApiError';
		this.status = status;
		this.userErrors = userErrors || [];
	}
}

/**
 * @param {string} shop shop_domain, e.g. "example.myshopify.com"
 * @param {string} accessToken offline access token for that shop
 * @param {string} query GraphQL document
 * @param {object} [variables]
 */
export async function adminGraphql(shop, accessToken, query, variables = {}) {
	const res = await fetch(`https://${shop}/admin/api/${ADMIN_API_VERSION}/graphql.json`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'x-shopify-access-token': accessToken,
		},
		body: JSON.stringify({ query, variables }),
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok) {
		throw new ShopifyApiError(`Shopify Admin API returned ${res.status}`, { status: res.status });
	}
	if (Array.isArray(body.errors) && body.errors.length) {
		throw new ShopifyApiError(body.errors.map((e) => e.message).join('; '), { status: 502 });
	}
	return body.data;
}

/**
 * Walks a mutation's `userErrors: [{ field, message }]` array (every
 * Shopify mutation used here returns one) and throws if non-empty.
 */
export function assertNoUserErrors(result, path) {
	const userErrors = path.split('.').reduce((acc, key) => acc?.[key], result)?.userErrors;
	if (Array.isArray(userErrors) && userErrors.length) {
		throw new ShopifyApiError(userErrors.map((e) => `${(e.field || []).join('.')}: ${e.message}`).join('; '), {
			status: 422,
			userErrors,
		});
	}
}
