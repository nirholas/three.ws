// GET /api/shopify/install?shop=<shop>.myshopify.com
//
// Start of OAuth. Shopify (or the merchant pasting the app's listing URL)
// lands here first; this redirects to the shop's own /admin/oauth/authorize
// with a random state nonce carried in a short-lived signed cookie, verified
// back in callback.js.

import { cors, method, wrap, error, redirect } from '../_lib/http.js';
import { cookie } from '../_lib/identities.js';
import { randomBytes } from 'node:crypto';
import { apiKey, appUrl, isValidShopDomain, shopifyConfigured, SCOPES, OAUTH_STATE_COOKIE } from '../_lib/shopify/config.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;
	if (!shopifyConfigured()) {
		return error(res, 501, 'not_configured', 'Shopify app is not configured (SHOPIFY_API_KEY/SHOPIFY_API_SECRET unset)');
	}

	const url = new URL(req.url, 'http://x');
	const shop = (url.searchParams.get('shop') || '').trim().toLowerCase();
	if (!isValidShopDomain(shop)) {
		return error(res, 400, 'invalid_shop', 'shop must be a *.myshopify.com domain');
	}

	const state = randomBytes(24).toString('hex');
	res.setHeader('set-cookie', cookie(OAUTH_STATE_COOKIE, state, 600));

	const authorizeUrl = new URL(`https://${shop}/admin/oauth/authorize`);
	authorizeUrl.searchParams.set('client_id', apiKey());
	authorizeUrl.searchParams.set('scope', SCOPES);
	authorizeUrl.searchParams.set('redirect_uri', `${appUrl()}/api/shopify/callback`);
	authorizeUrl.searchParams.set('state', state);

	return redirect(res, authorizeUrl.toString());
});
