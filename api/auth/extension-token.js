// POST /api/auth/extension-token — exchange the caller's browser session for a
// Bearer access token the Walk Avatar extension can use.
//
// Why this exists: the extension popup runs on a chrome-extension:// origin, so
// the site's __Host-sid session cookie (SameSite) is never attached to its
// cross-site fetches. The extension therefore authenticates with a Bearer token
// instead. After the user signs in on three.ws, the /extension/auth-callback
// page calls this endpoint same-origin (the session cookie DOES attach there),
// receives a token, and hands it to the extension's background worker via the
// callback URL. The token is a standard HS256 access JWT — identical shape to
// the OAuth access tokens authenticateBearer() already verifies — scoped to
// avatars:read so the extension can list avatars and read identity, nothing more.

import { SignJWT } from 'jose';
import { getSessionUser, WALK_EXTENSION_CLIENT_ID } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { cors, error, json, method, wrap, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { env } from '../_lib/env.js';
import { randomToken } from '../_lib/crypto.js';

// 30 days — matches the browser session TTL so the extension stays signed in as
// long as a same-device web session would, and re-auth is a single click.
const EXTENSION_TOKEN_TTL_SEC = 60 * 60 * 24 * 30;
const EXTENSION_SCOPE = 'avatars:read';
// Shared with revokeAccountCredentials (api/_lib/auth.js): the token is stateless,
// so deleting the account, resetting the password or signing out everywhere
// kills it through the oauth_client_revocations cutoff for this client id.
const EXTENSION_CLIENT_ID = WALK_EXTENSION_CLIENT_ID;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	// Defense in depth: this mints a token from the session cookie, so only allow
	// it from our own origin. A cross-origin attacker can't read the JSON response
	// (CORS), but refusing foreign Origins outright keeps the surface tight.
	const origin = req.headers.origin;
	if (origin) {
		let ok = false;
		try {
			ok = new URL(origin).origin === new URL(env.APP_ORIGIN).origin;
		} catch {
			ok = false;
		}
		if (!ok) return error(res, 403, 'forbidden', 'cross-origin token mint not allowed');
	}

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const session = await getSessionUser(req);
	if (!session) return error(res, 401, 'unauthorized', 'sign in on three.ws first');

	const [user] = await sql`
		SELECT id, username, display_name FROM users
		WHERE id = ${session.id} AND deleted_at IS NULL
		LIMIT 1
	`;
	if (!user) return error(res, 404, 'not_found', 'user not found');

	const now = Math.floor(Date.now() / 1000);
	const expSec = now + EXTENSION_TOKEN_TTL_SEC;
	const token = await new SignJWT({
		scope: EXTENSION_SCOPE,
		client_id: EXTENSION_CLIENT_ID,
		token_use: 'access',
	})
		.setProtectedHeader({ alg: 'HS256', kid: env.JWT_KID, typ: 'JWT' })
		.setIssuer(env.ISSUER)
		.setSubject(user.id)
		.setAudience(env.MCP_RESOURCE)
		.setIssuedAt(now)
		.setExpirationTime(expSec)
		.setJti(randomToken(16))
		.sign(new TextEncoder().encode(env.JWT_SECRET));

	return json(res, 200, {
		token,
		token_type: 'Bearer',
		scope: EXTENSION_SCOPE,
		expires_at: new Date(expSec * 1000).toISOString(),
		user: {
			id: user.id,
			username: user.username || null,
			display_name: user.display_name || user.username || 'three.ws user',
		},
	});
});
