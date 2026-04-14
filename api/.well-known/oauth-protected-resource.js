// RFC 9728 — OAuth 2.0 Protected Resource Metadata
// MCP spec requires this at the MCP resource's well-known path.
// We expose it here at the root and also per-resource at /api/mcp/.well-known/...

import { env } from '../_lib/env.js';
import { cors, json, method, wrap } from '../_lib/http.js';

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
