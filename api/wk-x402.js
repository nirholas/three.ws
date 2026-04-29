// /.well-known/x402 — x402 resource discovery (fallback; /openapi.json is preferred)
// Spec: https://x402scan.com/discovery

import { cors, json, method, wrap } from './_lib/http.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;
	return json(
		res,
		200,
		{
			version: 1,
			resources: ['POST /api/mcp'],
			schemes: ['solana-pay', 'evm-erc20', 'pump-agent-payments'],
			pump_agent_payments: {
				prep: '/api/pump/accept-payment-prep',
				confirm: '/api/pump/accept-payment-confirm',
				balances: '/api/pump/balances',
			},
		},
		{ 'cache-control': 'public, max-age=300' },
	);
});
