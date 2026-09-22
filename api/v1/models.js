// GET /api/v1/models: the OpenAI-compatible model list for the metered endpoint.
//
// OpenAI clients call this to populate their model picker, so it answers in the
// `{ object: "list", data: [...] }` shape they expect, with the published
// three.ws price attached to each model. Public: listing models needs no key.

import { cors, json, method, wrap } from '../_lib/http.js';
import { inferencePricing } from '../_lib/inference-billing.js';

// Fixed for the life of the model id, so clients that sort or cache by
// `created` see a stable value.
const CREATED = Math.floor(Date.UTC(2026, 8, 22) / 1000);

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET, OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;
	const pricing = inferencePricing();
	res.setHeader('cache-control', 'public, max-age=300');
	return json(res, 200, {
		object: 'list',
		data: [
			{
				id: pricing.model,
				object: 'model',
				created: CREATED,
				owned_by: 'three.ws',
				description:
					'The three.ws agent runtime: a tool-using loop with live token prices, web search, Solana balances, ' +
					'a rug/honeypot safety verdict, smart-money activity and .sol resolution. Read-only: it cannot move funds.',
				context_messages: 40,
				tools: 'server-side, read-only',
				pricing: {
					input_usd_per_mtok: pricing.input_usd_per_mtok,
					output_usd_per_mtok: pricing.output_usd_per_mtok,
					min_call_usd: pricing.min_call_usd,
					billed_to: 'account credits (https://three.ws/credits)',
				},
			},
		],
	});
});
