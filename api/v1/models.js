// GET /api/v1/models: the model list.
//
// Two lists in one answer, so an OpenAI client and a three.ws client can both
// read it:
//   data          the OpenAI-compatible list for POST /api/v1/chat/completions
//                 (`{ object: "list", data: [...] }`), with the published
//                 three.ws price attached. OpenAI clients read only this.
//   agent_models  every model an agent's brain can be set to (the agent's
//                 default model, or a per-message override): family, context
//                 window, tool support, list price per million tokens, free-tier
//                 coverage and live health (api/_lib/model-catalog.js). The same
//                 rows back three://models and the model picker.
//   free_tier     the daily message allowance on the free models, read live
//                 from app_settings['free_tier'].
//
// Query: `health=live` probes the open-model roster before answering (cached
// five minutes server-side, so a busy picker costs one sweep per window);
// the default returns the last probe without waiting on one. Public: listing
// models needs no key.

import { cors, json, method, wrap } from '../_lib/http.js';
import { inferencePricing } from '../_lib/inference-billing.js';
import { listCatalogModels, freeTierAllowance } from '../_lib/model-catalog.js';

// Fixed for the life of the model id, so clients that sort or cache by
// `created` see a stable value.
const CREATED = Math.floor(Date.UTC(2026, 8, 22) / 1000);

function runtimeModel() {
	const pricing = inferencePricing();
	return {
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
	};
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET, OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;
	const url = new URL(req.url, 'http://internal');
	const live = url.searchParams.get('health') === 'live';

	const [catalog, freeTier] = await Promise.all([
		listCatalogModels({ health: live ? 'live' : 'cached' }),
		freeTierAllowance().catch(() => null),
	]);

	res.setHeader('cache-control', live ? 'no-store' : 'public, max-age=60');
	return json(res, 200, {
		object: 'list',
		data: [runtimeModel()],
		agent_models: catalog.models,
		health_checked_at: catalog.health_checked_at,
		free_tier: freeTier,
		note:
			'data lists the models POST /api/v1/chat/completions serves. agent_models lists every model an agent ' +
			'can run on: set one as the agent default or pass it as a per-message `model` override. Prices are USD ' +
			'per million tokens [input, output]; free models draw on the daily free_tier allowance instead.',
	});
});
