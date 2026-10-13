// GET /api/shopify/callback?code=...&shop=...&state=...&hmac=...&timestamp=...
//
// Finishes OAuth: verifies the query HMAC and the state cookie from install.js,
// exchanges the code for an OFFLINE access token, stores the session,
// registers the mandatory compliance webhooks, and lands the merchant in the
// embedded admin UI.

import { cors, method, wrap, error, redirect } from '../_lib/http.js';
import { readCookie, clearCookie } from '../_lib/identities.js';
import { apiKey, apiSecret, isValidShopDomain, shopifyConfigured, OAUTH_STATE_COOKIE } from '../_lib/shopify/config.js';
import { verifyOAuthHmac } from '../_lib/shopify/hmac.js';
import { saveShopSession } from '../_lib/shopify/store.js';
import { registerMandatoryWebhooks } from '../_lib/shopify/webhook-register.js';

async function exchangeCodeForToken(shop, code) {
	const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ client_id: apiKey(), client_secret: apiSecret(), code }),
		signal: AbortSignal.timeout(20_000),
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok || !body.access_token) {
		throw Object.assign(new Error(`token exchange failed: ${res.status}`), { status: 502 });
	}
	return { accessToken: body.access_token, scope: body.scope || '' };
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;
	if (!shopifyConfigured()) {
		return error(res, 501, 'not_configured', 'Shopify app is not configured');
	}

	const url = new URL(req.url, 'http://x');
	const shop = (url.searchParams.get('shop') || '').trim().toLowerCase();
	if (!isValidShopDomain(shop)) return error(res, 400, 'invalid_shop', 'shop must be a *.myshopify.com domain');

	if (!verifyOAuthHmac(url.searchParams, apiSecret())) {
		return error(res, 401, 'invalid_hmac', 'OAuth callback HMAC verification failed');
	}

	const state = url.searchParams.get('state') || '';
	const cookieState = readCookie(req, OAUTH_STATE_COOKIE);
	if (!state || !cookieState || state !== cookieState) {
		return error(res, 401, 'invalid_state', 'OAuth state mismatch; start the install flow again');
	}
	res.setHeader('set-cookie', clearCookie(OAUTH_STATE_COOKIE));

	const code = url.searchParams.get('code') || '';
	if (!code) return error(res, 400, 'missing_code', 'missing authorization code');

	let accessToken, scope;
	try {
		({ accessToken, scope } = await exchangeCodeForToken(shop, code));
	} catch (err) {
		return error(res, 502, 'token_exchange_failed', err?.message || 'token exchange failed');
	}

	await saveShopSession(shop, accessToken, scope);

	try {
		await registerMandatoryWebhooks(shop, accessToken);
	} catch (err) {
		// Webhook registration failing must not strand the install: the merchant
		// is mid-flow and a retry endpoint can re-run this safely (webhookSubscriptionCreate
		// is idempotent per topic+shop on Shopify's side). Surface it in logs only.
		console.error('shopify webhook registration failed', shop, err?.message || err);
	}

	return redirect(res, `https://${shop}/admin/apps/${apiKey()}`);
});
