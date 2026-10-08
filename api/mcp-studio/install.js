// Mint a free-studio install token.
//
//   POST /api/mcp-studio/install   201 { token, connector_urls, ... }
//
// An install token gives one keyless MCP installation (a Grok Bot connector, a
// hosted agent, any client behind a shared egress) its own generation budget on
// the free 3D studio without an account. The connector URL carries it as
// `?install=<token>`; see ../_mcp-studio/install-token.js for the format and
// ../_mcp-studio/handler.js for how the caps key on it. Minting is free and
// anonymous, and rate-limited per IP, because each token is one more budget.

import { cors, wrap, json, error, method, rateLimited } from '../_lib/http.js';
import { limits, clientIp, STUDIO_LIMITS } from '../_lib/rate-limit.js';
import { mintInstallToken, connectorUrl } from '../_mcp-studio/install-token.js';

// Every studio surface honors the same token.
const SURFACES = {
	studio: '/api/mcp-studio',
	grok: '/api/mcp-grok',
	chatgpt: '/api/mcp-chatgpt',
};

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', origins: '*', payments: false })) return;
	if (!method(req, res, ['POST'])) return;

	const ip = clientIp(req);
	const rl = await limits.studioInstallMint(ip);
	if (!rl.success) {
		const reset = new Date(Number(rl.reset) || Date.now() + 60_000).toISOString();
		return rateLimited(
			res,
			rl,
			`install token limit reached: ${STUDIO_LIMITS.installMint.limit} new tokens per hour from one IP, resets at ${reset}. ` +
				'Reuse a token you already have; one token works on every studio connector URL.',
			{ reset_at: reset },
		);
	}

	const minted = mintInstallToken();
	if (!minted) {
		return error(res, 503, 'not_configured', 'install tokens are not configured on this deployment');
	}

	return json(
		res,
		201,
		{
			token: minted.token,
			created_at: minted.createdAt.toISOString(),
			connector_url: connectorUrl(minted.token, SURFACES.studio),
			connector_urls: Object.fromEntries(Object.entries(SURFACES).map(([k, p]) => [k, connectorUrl(minted.token, p)])),
			limits: {
				generations_per_minute: STUDIO_LIMITS.genBurst.limit,
				generations_per_hour: STUDIO_LIMITS.genHourly.limit,
				requests_per_minute: STUDIO_LIMITS.transport.limit,
			},
			note: 'Keep this URL private: anyone holding the token spends its budget. It never expires and unlocks no account or payment.',
		},
		{ 'cache-control': 'no-store' },
	);
});
