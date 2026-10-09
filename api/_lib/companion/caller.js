// Who is calling a companion route, and with which credential.
//
// Two kinds of credential reach /api/companion/*:
//
//   - The bridge token (`cmp_...`), which a device holds: the desktop app, the
//     CLI, the MCP server, a browser extension, a Raspberry Pi in the hallway.
//     It is the whole of what @three-ws/companion is given, so every call that
//     package makes (list the feed, mark a delivery spoken, answer one, read the
//     contacts, check sources now) has to accept it. It resolves to exactly one
//     account, and every store query downstream is scoped to that account's
//     user id, so it reaches its owner's companion and nothing else.
//   - A session cookie, an API key, or an OAuth access token, for everything.
//     A cookie session carries every scope; a bearer needs `profile`, because
//     private messages and the bridge token itself live behind these routes.
//
// Routes that change what the companion is (sources, settings, contact edits,
// rotating the token) do not take the bridge token: a leaked phone shortcut must
// not be able to swap a Telegram bot, read a stored credential, or rotate itself
// out from under its owner. Those answer a plain 403 that says so, instead of a
// 401 that reads like the token is wrong.

import { extractBearer, getRequestUser, requestUserHasScope } from '../auth.js';
import { error } from '../http.js';
import { userForIngestToken } from './store.js';

const BRIDGE_TOKEN_PREFIX = 'cmp_';

export function isBridgeToken(token) {
	return typeof token === 'string' && token.startsWith(BRIDGE_TOKEN_PREFIX);
}

/**
 * Resolve the caller, or answer the request with 401/403 and return null.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {{ bridge?: boolean }} [options] bridge: whether this route accepts the bridge token.
 * @returns {Promise<{ id: string, via: 'bridge_token' | 'session' | 'bearer' } | null>}
 */
export async function companionCaller(req, res, { bridge = false } = {}) {
	const bearer = extractBearer(req);
	if (isBridgeToken(bearer)) {
		if (!bridge) {
			error(
				res,
				403,
				'bridge_token_not_accepted',
				'the companion bridge token cannot change sources, settings, or contacts; sign in at three.ws/companion or use an API key with the profile scope',
			);
			return null;
		}
		const settings = await userForIngestToken(bearer);
		if (!settings) {
			error(res, 401, 'unauthorized', 'unknown bridge token, check three.ws/companion for the current one');
			return null;
		}
		return { id: settings.user_id, via: 'bridge_token' };
	}

	const user = await getRequestUser(req, res);
	if (!user) {
		error(res, 401, 'unauthorized', bridge ? 'sign in, or send your companion bridge token as a Bearer header' : 'sign in required');
		return null;
	}
	if (!requestUserHasScope(user, 'profile')) {
		error(res, 403, 'insufficient_scope', 'this token needs the profile scope');
		return null;
	}
	return { id: user.id, via: user.source === 'bearer' ? 'bearer' : 'session' };
}

/**
 * A bridge token travels in an Authorization header a browser never attaches on
 * its own, so a request authenticated by one carries no cross-site risk and
 * needs no CSRF token. Everything else goes through the normal check.
 */
export function needsCsrf(caller) {
	return caller.via !== 'bridge_token';
}
