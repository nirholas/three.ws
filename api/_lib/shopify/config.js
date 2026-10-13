// Shared Shopify app config: env access + the few constants every handler
// needs (API version, scopes, mandatory webhook topics). Reads process.env
// directly, matching how every other third-party integration in this repo
// (Discord Activity, Google sign-in) keeps its credentials local to its own
// module rather than growing the shared api/_lib/env.js.

// Admin API version: Shopify ships a new one every quarter and expects apps
// to move forward; pin to the latest stable release at build time and bump
// this string on the next quarterly pass (shopify.dev/docs/api/release-notes).
export const ADMIN_API_VERSION = '2026-10';

// The flow needs: read the shop's products + existing media, create new
// product media, and run the Billing API. No order/customer PII scope is
// requested, since the app never reads customer data (the privacy webhooks
// exist only because Shopify requires every app to answer them, not because
// this app stores anything they'd ever fire for).
export const SCOPES = 'read_products,write_products';

export const MANDATORY_WEBHOOK_TOPICS = Object.freeze([
	'CUSTOMERS_DATA_REQUEST',
	'CUSTOMERS_REDACT',
	'SHOP_REDACT',
	'APP_UNINSTALLED',
]);

export function shopifyConfigured() {
	return Boolean(process.env.SHOPIFY_API_KEY && process.env.SHOPIFY_API_SECRET);
}

export function apiKey() {
	return process.env.SHOPIFY_API_KEY || '';
}

export function apiSecret() {
	return process.env.SHOPIFY_API_SECRET || '';
}

// Where the OAuth callback and every link the embedded UI builds point back
// to. Falls back to the platform's own origin so a shop installed against a
// non-production deployment (local dev, a preview) still round-trips.
export function appUrl() {
	const explicit = (process.env.SHOPIFY_APP_URL || '').trim();
	if (explicit) return explicit.replace(/\/$/, '');
	const origin = (process.env.PUBLIC_APP_ORIGIN || 'https://three.ws').trim();
	return origin.replace(/\/$/, '');
}

// Usage-based pricing per product converted, in USD. $0.15 is the standard
// Forge tier's own per-call cost (api/_lib/forge-tiers.js priceUsdcAtomics);
// $0.49 covers that, Shopify's revenue share, and the staged-upload/GraphQL
// overhead with margin left over.
export const USAGE_PRICE_USD = '0.49';
export const USAGE_CAP_USD = '100.00';

// Billing API charges only clear real money once Shopify has approved the app
// for the App Store (shopify.dev: AppSubscriptionCreate is otherwise gated to
// apps with Public distribution). Until that review completes, every
// subscription this app creates is a test subscription: Shopify records the
// usage but never settles it, so the flow is fully exercisable pre-launch.
// Flip SHOPIFY_BILLING_LIVE=1 once the app is live on the App Store.
export function billingTestMode() {
	return process.env.SHOPIFY_BILLING_LIVE !== '1';
}

const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

// Shared between install.js (sets it) and callback.js (reads it) for the
// OAuth state-nonce round trip.
export const OAUTH_STATE_COOKIE = '__Host-shopify-oauth-state';

export function isValidShopDomain(shop) {
	return typeof shop === 'string' && shop.length <= 100 && SHOP_DOMAIN_RE.test(shop);
}
