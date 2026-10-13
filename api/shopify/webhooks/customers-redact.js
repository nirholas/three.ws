// POST /api/shopify/webhooks/customers-redact (mandatory GDPR webhook)
//
// Fired 10 days after a customer redaction request. Same story as
// customers-data-request.js: this app stores nothing keyed by a customer id
// (media jobs and billing records are keyed by shop only), so there is
// nothing to erase. Still mandatory to implement, verify, and answer 200.

import { cors, method, wrap, error, json } from '../../_lib/http.js';
import { verifyAndClaim, WebhookAuthError } from '../../_lib/shopify/webhook-verify.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	try {
		await verifyAndClaim(req, 'customers/redact');
	} catch (err) {
		if (err instanceof WebhookAuthError) return error(res, 401, 'invalid_hmac', 'webhook HMAC verification failed');
		throw err;
	}

	return json(res, 200, { ok: true, customer_data_held: false });
});
