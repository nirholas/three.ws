// POST /api/shopify/billing/activate
//
// Starts the shop's usage-based AppSubscription and hands back Shopify's own
// confirmation URL; the embedded UI must redirect the merchant's TOP-LEVEL
// browser tab there (App Bridge's Redirect action, never an iframe) so they
// can approve the plan on Shopify's own page.

import { cors, method, wrap, error, json } from '../../_lib/http.js';
import { authenticateEmbeddedRequest, RequestAuthError } from '../../_lib/shopify/auth-request.js';
import { createUsageSubscription } from '../../_lib/shopify/billing.js';
import { saveBillingSubscription } from '../../_lib/shopify/store.js';
import { appUrl } from '../../_lib/shopify/config.js';
import { ShopifyApiError } from '../../_lib/shopify/graphql.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	let shop, accessToken;
	try {
		({ shop, accessToken } = await authenticateEmbeddedRequest(req));
	} catch (err) {
		if (err instanceof RequestAuthError) return error(res, err.status, 'unauthorized', err.message);
		throw err;
	}

	try {
		const returnUrl = `${appUrl()}/api/shopify/billing/confirm?shop=${encodeURIComponent(shop)}`;
		const sub = await createUsageSubscription(shop, accessToken, returnUrl);
		await saveBillingSubscription(shop, {
			subscriptionId: sub.subscriptionId,
			lineItemId: sub.lineItemId,
			testMode: sub.testMode,
			status: 'pending',
		});
		return json(res, 200, { confirmationUrl: sub.confirmationUrl, testMode: sub.testMode });
	} catch (err) {
		if (err instanceof ShopifyApiError) return error(res, err.status || 502, 'shopify_api_error', err.message);
		throw err;
	}
});
