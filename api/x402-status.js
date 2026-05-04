// GET /api/x402-status — operational probe for the x402 wiring.
//
// Reports the configured pay-to addresses, asset mints/contracts, and probes
// each facilitator's /supported endpoint to confirm it advertises scheme=exact
// for the network we route to it. Surfaces misconfigurations (e.g. Coinbase's
// reference facilitator, which only supports base-sepolia) before a paying
// client hits a 502.

import { cors, json, method, wrap } from './_lib/http.js';
import { env } from './_lib/env.js';
import { paymentRequirements, probeFacilitators, X402_VERSION } from './_lib/x402-spec.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const accepts = paymentRequirements({
		resource: `${env.APP_ORIGIN}/api/mcp`,
		description: 'MCP tool call',
	});
	const facilitators = await probeFacilitators();
	const ok = facilitators.every((f) => f.ok);

	return json(
		res,
		ok ? 200 : 503,
		{
			ok,
			x402Version: X402_VERSION,
			accepts,
			facilitators,
			env: {
				X402_PAY_TO_SOLANA: env.X402_PAY_TO_SOLANA || null,
				X402_PAY_TO_BASE: env.X402_PAY_TO_BASE || null,
				X402_ASSET_MINT_SOLANA: env.X402_ASSET_MINT_SOLANA || null,
				X402_ASSET_ADDRESS_BASE: env.X402_ASSET_ADDRESS_BASE || null,
				X402_FEE_PAYER_SOLANA: env.X402_FEE_PAYER_SOLANA || null,
				X402_MAX_AMOUNT_REQUIRED: env.X402_MAX_AMOUNT_REQUIRED || null,
			},
		},
		{ 'cache-control': 'no-store' },
	);
});
