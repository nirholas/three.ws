// POST /api/shopify/webhooks/shop-redact (mandatory GDPR webhook)
//
// Fired 48 hours after a shop uninstalls the app. Unlike the two
// customer-scoped privacy webhooks, this one is not a no-op: it requires the
// app to actually erase everything it stored for the shop (media jobs,
// billing records, the OAuth session row).

import { cors, method, wrap, error, json } from '../../_lib/http.js';
import { verifyAndClaim, WebhookAuthError } from '../../_lib/shopify/webhook-verify.js';
import { eraseShopData } from '../../_lib/shopify/store.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	let shop, fresh;
	try {
		({ shop, fresh } = await verifyAndClaim(req, 'shop/redact'));
	} catch (err) {
		if (err instanceof WebhookAuthError) return error(res, 401, 'invalid_hmac', 'webhook HMAC verification failed');
		throw err;
	}

	if (fresh) await eraseShopData(shop);
	return json(res, 200, { ok: true });
});
