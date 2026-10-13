// Shared verify-then-claim path for every /api/shopify/webhooks/* receiver:
// read the raw body, check the HMAC, 401 on failure (Shopify's own
// requirement: "if a mandatory compliance webhook sends a request with an
// invalid Shopify HMAC header, then the app must return a 401 Unauthorized"),
// then claim the delivery id so a retry is a 200 no-op instead of a second
// run of the handler.

import { readBody } from '../http.js';
import { verifyWebhookHmac } from './hmac.js';
import { apiSecret } from './config.js';
import { claimWebhookDelivery } from './store.js';

export class WebhookAuthError extends Error {}

/**
 * @returns {Promise<{ shop: string, body: object, fresh: boolean }>}
 */
export async function verifyAndClaim(req, topic) {
	const raw = await readBody(req, 1_000_000);
	const headerSig = req.headers['x-shopify-hmac-sha256'];
	if (!verifyWebhookHmac(raw, headerSig, apiSecret())) {
		throw new WebhookAuthError('invalid HMAC');
	}
	const shop = String(req.headers['x-shopify-shop-domain'] || '');
	const deliveryId = String(req.headers['x-shopify-webhook-id'] || '');
	const fresh = deliveryId ? await claimWebhookDelivery(shop, topic, deliveryId) : true;
	let body = {};
	try {
		body = JSON.parse(raw.toString('utf8'));
	} catch {
		body = {};
	}
	return { shop, body, fresh };
}
