// Verifies the session token App Bridge attaches to every embedded-app
// request (Authorization: Bearer <token>). This is the auth Shopify now
// requires embedded apps to use instead of cookies (shopify.dev/docs/apps/auth/get-access-tokens/session-tokens):
// a short-lived (1 minute) HS256 JWT, signed with the app's client secret,
// that proves the request came from App Bridge running inside an admin the
// merchant is actually signed into: no third-party cookie, works in
// Incognito, which the App Store's automated embedded-app check requires.
//
// Claims: iss (shop admin URL), dest (shop origin), aud (app's API key),
// sub (the Shopify staff user id), exp/nbf/iat, jti, sid.

import { jwtVerify } from 'jose';
import { apiKey, apiSecret, isValidShopDomain } from './config.js';

export class SessionTokenError extends Error {
	constructor(message) {
		super(message);
		this.name = 'SessionTokenError';
	}
}

function shopFromDest(dest) {
	try {
		return new URL(dest).hostname;
	} catch {
		return '';
	}
}

/**
 * @param {string} token raw bearer token (without the "Bearer " prefix)
 * @returns {Promise<{ shop: string, userId: string, sessionId: string }>}
 */
export async function verifySessionToken(token) {
	if (!token || typeof token !== 'string') throw new SessionTokenError('missing session token');
	const secret = apiSecret();
	if (!secret) throw new SessionTokenError('shopify app is not configured');

	let payload;
	try {
		({ payload } = await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ['HS256'] }));
	} catch (err) {
		throw new SessionTokenError(`session token rejected: ${err?.message || err}`);
	}

	if (payload.aud !== apiKey()) throw new SessionTokenError('session token aud does not match this app');

	const shop = shopFromDest(String(payload.dest || ''));
	if (!isValidShopDomain(shop)) throw new SessionTokenError('session token dest is not a valid shop domain');

	const iss = String(payload.iss || '');
	if (!iss.includes(shop)) throw new SessionTokenError('session token iss/dest mismatch');

	return { shop, userId: String(payload.sub || ''), sessionId: String(payload.sid || '') };
}

/** Reads the bearer token out of an incoming request's Authorization header. */
export function bearerFromRequest(req) {
	const raw = req.headers?.authorization || req.headers?.Authorization;
	const value = Array.isArray(raw) ? raw[0] : raw;
	const match = typeof value === 'string' && /^Bearer\s+(.+)$/i.exec(value.trim());
	return match ? match[1] : '';
}
