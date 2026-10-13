// POST /api/shopify/webhooks/customers-data-request (mandatory GDPR webhook)
//
// Fired when a shop owner requests the data this app holds about one of
// their customers. This app never reads customer data (scopes are
// read_products,write_products only; see api/_lib/shopify/config.js) and
// stores nothing keyed by a customer id, so there is nothing to return.
// Still mandatory to implement, verify, and answer 200 per Shopify's
// compliance-webhook requirements.

import { cors, method, wrap, error, json } from '../../_lib/http.js';
import { verifyAndClaim, WebhookAuthError } from '../../_lib/shopify/webhook-verify.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	try {
		await verifyAndClaim(req, 'customers/data_request');
	} catch (err) {
		if (err instanceof WebhookAuthError) return error(res, 401, 'invalid_hmac', 'webhook HMAC verification failed');
		throw err;
	}

	return json(res, 200, { ok: true, customer_data_held: false });
});
