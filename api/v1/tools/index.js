// GET /api/v1/tools: the tool gateway's price list and input shapes.
//
// Public and cacheable. The pricing page, docs/tool-gateway.md and agent
// clients all read the same rows from api/_lib/tool-gateway/pricing.js, so a
// price shown anywhere is the price the meter charges.

import { defineEndpoint } from '../../_lib/gateway.js';
import { gatewayPricing } from '../../_lib/tool-gateway/pricing.js';
import { GATEWAY_INPUTS } from '../../_lib/tool-gateway/schemas.js';

export default defineEndpoint({
	name: 'v1.tools.list',
	method: 'GET',
	auth: 'public',
	handler: ({ res }) => {
		res.setHeader('cache-control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
		return {
			billing: 'account credits (https://three.ws/credits), the same balance model calls draw from',
			call: 'POST /api/v1/tools/{tool} with a JSON body of the tool inputs',
			tools: gatewayPricing().map((t) => ({ ...t, input: GATEWAY_INPUTS[t.tool] || null })),
		};
	},
});
