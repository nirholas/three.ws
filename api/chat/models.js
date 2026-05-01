import { env } from '../_lib/env.js';
import { cors, json, method, wrap } from '../_lib/http.js';

// Cache the fetched model list for 5 minutes to avoid hammering OpenRouter.
let cachedModels = null;
let cacheExpiresAt = 0;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	if (!env.OPENROUTER_API_KEY)
		return json(res, 200, { data: [] });

	const now = Date.now();
	if (cachedModels && now < cacheExpiresAt) {
		return json(res, 200, { data: cachedModels });
	}

	const upstream = await fetch('https://openrouter.ai/api/v1/models', {
		headers: {
			Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
			'HTTP-Referer': 'https://three.ws',
			'X-Title': 'three.ws chat',
		},
	});

	if (!upstream.ok)
		return json(res, 200, { data: [] });

	const { data: allModels } = await upstream.json();

	// Only expose free-tier models so completions work via the proxy without a user key.
	const freeModels = (allModels ?? []).filter((m) => m.id.endsWith(':free'));

	cachedModels = freeModels;
	cacheExpiresAt = now + 5 * 60 * 1000;

	return json(res, 200, { data: freeModels });
});
