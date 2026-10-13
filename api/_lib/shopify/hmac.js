// Shopify's two HMAC schemes: the OAuth query-string signature (install and
// callback redirects) and the webhook body signature (every /api/shopify/webhooks/*
// receiver). Both are HMAC-SHA256 with the app's client secret, but keyed over
// different material, so they are not interchangeable: see shopify.dev/docs/apps/auth/oauth/getting-started.

import { createHmac, timingSafeEqual } from 'node:crypto';

function safeEqualHex(a, b) {
	const bufA = Buffer.from(String(a || ''), 'hex');
	const bufB = Buffer.from(String(b || ''), 'hex');
	if (bufA.length !== bufB.length || bufA.length === 0) return false;
	return timingSafeEqual(bufA, bufB);
}

// OAuth install/callback: every query param except `hmac` (and `signature`,
// a legacy alias Shopify no longer sends but some docs still mention) is
// sorted by key, joined as `key=value&key=value` with `&`/`%` escaped per
// Shopify's documented scheme, then HMAC-SHA256'd as hex.
export function verifyOAuthHmac(searchParams, secret) {
	const hmac = searchParams.get('hmac');
	if (!hmac || !secret) return false;
	const pairs = [];
	for (const [key, value] of searchParams.entries()) {
		if (key === 'hmac' || key === 'signature') continue;
		pairs.push([key, value]);
	}
	pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	const message = pairs
		.map(([k, v]) => `${k.replace(/%/g, '%25').replace(/=/g, '%3D')}=${v.replace(/%/g, '%25').replace(/&/g, '%26')}`)
		.join('&');
	const expected = createHmac('sha256', secret).update(message).digest('hex');
	return safeEqualHex(expected, hmac);
}

// Webhook delivery: HMAC-SHA256 of the exact raw request body, base64-encoded,
// carried in the X-Shopify-Hmac-Sha256 header. Must run on the raw bytes
// Shopify signed, before any JSON.parse.
export function verifyWebhookHmac(rawBody, headerValue, secret) {
	if (!headerValue || !secret) return false;
	const expected = createHmac('sha256', secret).update(rawBody).digest('base64');
	const a = Buffer.from(String(headerValue), 'utf8');
	const b = Buffer.from(expected, 'utf8');
	if (a.length !== b.length || a.length === 0) return false;
	return timingSafeEqual(a, b);
}
