// GET /api/shopify/billing/status
//
// Current billing state for the embedded UI's banner: whether the usage
// subscription exists and is active, so the UI can gate generation behind
// "activate billing" until Shopify confirms the merchant approved it.

import { cors, method, wrap, error, json } from '../../_lib/http.js';
import { authenticateEmbeddedRequest, RequestAuthError } from '../../_lib/shopify/auth-request.js';
import { getBillingSubscription } from '../../_lib/shopify/store.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	let shop;
	try {
		({ shop } = await authenticateEmbeddedRequest(req));
	} catch (err) {
		if (err instanceof RequestAuthError) return error(res, err.status, 'unauthorized', err.message);
		throw err;
	}

	const billing = await getBillingSubscription(shop);
	return json(res, 200, {
		status: billing?.status || 'none',
		testMode: billing?.test_mode ?? true,
	});
});
