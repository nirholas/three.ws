// Mint a free, anonymous install token for the keyless 3D Studio MCP servers.
//
//   POST /api/mcp-studio/install   ->  { token, connector_url, grok_connector_url, ... }
//
// No account, no key. Cloud agents share one egress IP, so the studio's
// per-caller generation caps key on this token instead (see
// api/_mcp-studio/handler.js). Creation is rate-limited per IP and the token is
// stored hashed. Docs: docs/mcp-studio.md, "Install tokens".

import { cors, json, method, wrap, rateLimited, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { createInstallToken } from '../_lib/mcp-studio-installs.js';

const ORIGIN = 'https://three.ws';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', origins: '*', payments: false })) return;
	if (!method(req, res, ['POST'])) return;

	const rl = await limits.studioInstallCreate(clientIp(req));
	if (!rl.success) return rateLimited(res, rl, 'install token limit reached for this network, try again later');

	let token;
	try {
		token = await createInstallToken();
	} catch (err) {
		console.error('[mcp-studio/install] could not store a token:', err.message);
		return error(res, 503, 'install_unavailable', 'could not create an install token right now, retry in a moment');
	}

	return json(
		res,
		201,
		{
			token,
			connector_url: `${ORIGIN}/api/mcp-studio?install=${token}`,
			grok_connector_url: `${ORIGIN}/api/mcp-grok?install=${token}`,
			note: 'Anonymous and free. Keep the URL private: anyone holding it spends this installation\'s generation budget.',
		},
		{ 'cache-control': 'no-store' },
	);
});
