// Who may make or upload something on three.ws.
//
// Every 3D model, upload and derived asset needs someone answerable for it.
// Anonymous creation turned the platform into a free, unaccountable generator
// and image host: nothing tied a model to a person, so abuse could not be traced,
// limited per person, or removed at the source. A creation request is accepted
// from exactly two kinds of caller:
//
//   1. A signed-in account: a session cookie (the browser), or an API key /
//      OAuth bearer (scripts, plugins, MCP clients). See getRequestUser.
//   2. A platform job: a server-side three.ws surface that has already answered
//      for its caller some other way (a cron, a paid x402 or OKX call that a
//      wallet signed, a Shopify merchant install, the X-mention bot replying to
//      one named account). These present the deployment's own secret
//      (`x-forge-seed: CRON_SECRET`), which never leaves the server.
//
// Anything else gets 401 `sign_in_required` with where to sign in and where to
// make an API key, so a browser can show a link and a script can say what to set.

import { getRequestUser } from './auth.js';
import { constantTimeEquals } from './crypto.js';
import { env } from './env.js';
import { json } from './http.js';

export const SIGN_IN_REQUIRED = 'sign_in_required';
export const SIGN_IN_URL = '/login';
export const API_KEYS_URL = '/dashboard/api-keys';

/** True when the request carries the deployment's platform-job secret. */
export function isPlatformCall(req) {
	const raw = req?.headers?.['x-forge-seed'];
	const token = Array.isArray(raw) ? raw[0] : raw;
	if (!token) return false;
	const secret = env.CRON_SECRET;
	return Boolean(secret) && constantTimeEquals(String(token), String(secret));
}

/**
 * Send the 401 every creation surface answers an anonymous caller with.
 * @param {import('http').ServerResponse} res
 * @param {{ action?: string }} [opts] what the caller tried, in a short phrase
 *   that completes "Sign in to ..." (e.g. "make a 3D model", "upload a photo").
 */
export function signInRequired(res, { action = 'make a 3D model' } = {}) {
	res.setHeader('www-authenticate', 'Bearer realm="three.ws", error="invalid_token"');
	return json(res, 401, {
		error: SIGN_IN_REQUIRED,
		message: `Sign in to ${action}. A three.ws account is free.`,
		// Browsers follow sign_in_url; scripts, plugins and MCP clients send a key
		// from api_keys_url as `Authorization: Bearer <key>`.
		sign_in_url: SIGN_IN_URL,
		api_keys_url: API_KEYS_URL,
	});
}

/**
 * Resolve the accountable caller, or answer 401 and return null.
 * Cached on the request so a handler and the helpers it calls agree and the
 * session lookup runs once.
 * @returns {Promise<{ user: { id: string } | null, platform: boolean } | null>}
 */
export async function requireCreator(req, res, { action, allowPlatform = true } = {}) {
	const who = await resolveCreator(req, res);
	if (who.user) return who;
	if (allowPlatform && who.platform) return who;
	signInRequired(res, { action });
	return null;
}

// A platform job that already authenticated its person some other way (an MCP
// connector whose OAuth token is bound to the MCP audience, an agent-to-agent
// call) names that account in `x-forge-on-behalf-user`. Honoured only beside the
// platform secret, so a browser cannot claim to be someone else with it.
const USER_ID_RE = /^[A-Za-z0-9_:.@-]{1,128}$/;

function onBehalfUser(req) {
	const raw = req?.headers?.['x-forge-on-behalf-user'];
	const id = String((Array.isArray(raw) ? raw[0] : raw) || '').trim();
	return USER_ID_RE.test(id) ? { id, source: 'platform' } : null;
}

/** The accountable caller without answering: `{ user, platform }`, either may be empty. */
export async function resolveCreator(req, res) {
	if (req.__twxCreator) return req.__twxCreator;
	const platform = isPlatformCall(req);
	let user = platform ? onBehalfUser(req) : null;
	if (!user) {
		try {
			const found = await getRequestUser(req, res);
			user = found?.id ? found : null;
		} catch {
			user = null;
		}
	}
	req.__twxCreator = { user, platform };
	return req.__twxCreator;
}

/**
 * Headers that carry the caller's own credential to a same-deployment
 * self-call (a wrapper endpoint forwarding to /api/forge), so the inner call
 * is attributed to, rate-limited as, and authorised by the same person.
 */
export function forwardCreatorAuth(req) {
	const out = {};
	const cookie = req?.headers?.cookie;
	const authorization = req?.headers?.authorization;
	if (cookie) out.cookie = Array.isArray(cookie) ? cookie.join('; ') : cookie;
	if (authorization) out.authorization = Array.isArray(authorization) ? authorization[0] : authorization;
	return out;
}

/**
 * Headers for a platform job's self-call. `onBehalf` marks a job that acts for
 * an outside person (a paid buyer, a merchant, an X account): it is trusted, but
 * its creations are that person's, so they are born unlisted like any maker's,
 * not public like the platform's own showcase seeds. `userId` names the three.ws
 * account the job already authenticated, so the creation is owned by it.
 */
export function platformAuthHeaders({ onBehalf = true, userId = null } = {}) {
	const secret = env.CRON_SECRET;
	if (!secret) return {};
	const id = userId != null && USER_ID_RE.test(String(userId)) ? String(userId) : null;
	return {
		'x-forge-seed': secret,
		...(onBehalf || id ? { 'x-forge-on-behalf': '1' } : {}),
		...(id ? { 'x-forge-on-behalf-user': id } : {}),
	};
}
