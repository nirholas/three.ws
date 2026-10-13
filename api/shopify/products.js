// GET /api/shopify/products?after=<cursor>
//
// Lists the shop's products (title, first image, whether a 3D model is
// already attached) for the embedded admin's product grid.

import { cors, method, wrap, error, json } from '../_lib/http.js';
import { authenticateEmbeddedRequest, RequestAuthError } from '../_lib/shopify/auth-request.js';
import { listProducts } from '../_lib/shopify/media.js';
import { ShopifyApiError } from '../_lib/shopify/graphql.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	let shop, accessToken;
	try {
		({ shop, accessToken } = await authenticateEmbeddedRequest(req));
	} catch (err) {
		if (err instanceof RequestAuthError) return error(res, err.status, 'unauthorized', err.message);
		throw err;
	}

	const url = new URL(req.url, 'http://x');
	const after = url.searchParams.get('after') || null;

	try {
		const { products, pageInfo } = await listProducts(shop, accessToken, { after });
		return json(res, 200, { products, pageInfo });
	} catch (err) {
		if (err instanceof ShopifyApiError) return error(res, err.status || 502, 'shopify_api_error', err.message);
		throw err;
	}
});
