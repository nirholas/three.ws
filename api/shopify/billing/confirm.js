// GET /api/shopify/billing/confirm?shop=<shop>.myshopify.com
//
// The returnUrl AppSubscriptionCreate redirects the merchant's browser to
// after they approve or decline on Shopify's own confirmation page. This is
// a full navigation (like callback.js), not an App Bridge XHR, so there is
// no session token here; the shop's own stored OAuth session is enough to
// re-ask Shopify's own record of what the merchant decided.

import { cors, method, wrap, error, redirect } from '../../_lib/http.js';
import { apiKey, isValidShopDomain } from '../../_lib/shopify/config.js';
import { getShopSession, setBillingStatus } from '../../_lib/shopify/store.js';
import { fetchActiveSubscription } from '../../_lib/shopify/billing.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const url = new URL(req.url, 'http://x');
	const shop = (url.searchParams.get('shop') || '').trim().toLowerCase();
	if (!isValidShopDomain(shop)) return error(res, 400, 'invalid_shop', 'shop must be a *.myshopify.com domain');

	const session = await getShopSession(shop);
	if (!session || session.uninstalled_at) {
		return error(res, 401, 'not_installed', 'app is not installed on this shop');
	}

	try {
		const active = await fetchActiveSubscription(shop, session.access_token);
		await setBillingStatus(shop, active && active.status === 'ACTIVE' ? 'active' : 'declined');
	} catch (err) {
		console.error('shopify billing confirm check failed', shop, err?.message || err);
	}

	return redirect(res, `https://${shop}/admin/apps/${apiKey()}`);
});
