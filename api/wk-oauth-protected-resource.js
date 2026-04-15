// RFC 9728 — OAuth 2.0 Protected Resource Metadata
// Served at /.well-known/oauth-protected-resource and at
// /api/mcp/.well-known/oauth-protected-resource via vercel.json rewrites.
// Kept outside dot-prefixed dirs: Vercel excludes `api/.well-known/**` from
// function deployment.

import { env } from './_lib/env.js';
import { cors, json, method, wrap } from './_lib/http.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;
	return json(res, 200, {
		resource: env.MCP_RESOURCE,
		authorization_servers: [env.APP_ORIGIN],
		bearer_methods_supported: ['header'],
		resource_documentation: `${env.APP_ORIGIN}/docs/mcp`,
		scopes_supported: ['avatars:read', 'avatars:write', 'avatars:delete', 'profile'],
	}, {
		'cache-control': 'public, max-age=300',
	});
});
