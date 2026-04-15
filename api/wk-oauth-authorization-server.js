// RFC 8414 — OAuth 2.0 Authorization Server Metadata
// https://datatracker.ietf.org/doc/html/rfc8414
//
// Served at /.well-known/oauth-authorization-server via vercel.json rewrite.
// The file lives outside a dot-prefixed directory because Vercel's build
// pipeline excludes `api/.well-known/**` from function deployment.

import { env } from './_lib/env.js';
import { cors, json, method, wrap } from './_lib/http.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;
	const base = env.APP_ORIGIN;
	return json(res, 200, {
		issuer: base,
		authorization_endpoint: `${base}/oauth/authorize`,
		token_endpoint: `${base}/api/oauth/token`,
		registration_endpoint: `${base}/api/oauth/register`,
		revocation_endpoint: `${base}/api/oauth/revoke`,
		introspection_endpoint: `${base}/api/oauth/introspect`,
		response_types_supported: ['code'],
		grant_types_supported: ['authorization_code', 'refresh_token'],
		code_challenge_methods_supported: ['S256'],
		token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
		scopes_supported: [
			'avatars:read',
			'avatars:write',
			'avatars:delete',
			'profile',
			'offline_access',
		],
		service_documentation: `${base}/docs/mcp`,
		ui_locales_supported: ['en'],
	}, {
		'cache-control': 'public, max-age=300',
	});
});
