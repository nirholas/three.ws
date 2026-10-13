// Shared auth path for every embedded-app API route: verify App Bridge's
// session token, then load the shop's stored offline access token (the
// session token proves WHO is calling, it is never itself usable against the
// Admin API).

import { SessionTokenError, verifySessionToken, bearerFromRequest } from './session-token.js';
import { getShopSession } from './store.js';

export class RequestAuthError extends Error {
	constructor(message, status = 401) {
		super(message);
		this.status = status;
	}
}

/** @returns {Promise<{ shop: string, accessToken: string, userId: string }>} */
export async function authenticateEmbeddedRequest(req) {
	const token = bearerFromRequest(req);
	let claims;
	try {
		claims = await verifySessionToken(token);
	} catch (err) {
		if (err instanceof SessionTokenError) throw new RequestAuthError(err.message, 401);
		throw err;
	}

	const session = await getShopSession(claims.shop);
	if (!session || session.uninstalled_at) {
		throw new RequestAuthError('app is not installed on this shop; reinstall to continue', 401);
	}

	return { shop: claims.shop, accessToken: session.access_token, userId: claims.userId };
}
