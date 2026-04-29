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
		},
		{ 'cache-control': 'public, max-age=300' },
	);
});
