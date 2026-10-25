// POST /api/shopify/webhooks/app-uninstalled
//
// Shopify fires this the moment a merchant uninstalls. The access token is
// already invalid by the time this arrives, so the only job here is to stop
// using it: mark the shop's session dead so no handler tries it again and the
// next install starts clean.

import { cors, method, wrap, error, json } from '../../_lib/http.js';
import { verifyAndClaim, applyClaimed, WebhookAuthError } from '../../_lib/shopify/webhook-verify.js';
import { markShopUninstalled } from '../../_lib/shopify/store.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	let shop, claim;
	try {
		claim = await verifyAndClaim(req, 'app/uninstalled');
		shop = claim.shop;
	} catch (err) {
		if (err instanceof WebhookAuthError) return error(res, 401, 'invalid_hmac', 'webhook HMAC verification failed');
		throw err;
	}

	await applyClaimed(claim, () => markShopUninstalled(shop));
	return json(res, 200, { ok: true });
});
