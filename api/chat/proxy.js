import { env } from '../_lib/env.js';
import { cors, error, method, wrap, readJson } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';

// Only allow free-tier OpenRouter models to prevent abuse.
const FREE_MODELS = new Set([
	'meta-llama/llama-3.3-70b-instruct:free',
	'meta-llama/llama-3.2-3b-instruct:free',
	'google/gemma-3-27b-it:free',
	'google/gemma-3-12b-it:free',
	'openai/gpt-oss-120b:free',
	'openai/gpt-oss-20b:free',
	'qwen/qwen3-coder:free',
	'qwen/qwen3-next-80b-a3b-instruct:free',
	'nousresearch/hermes-3-llama-3.1-405b:free',
]);

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	if (!env.OPENROUTER_API_KEY)
		return error(res, 503, 'not_configured', 'Built-in model not available');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'Too many requests — try again shortly');

	let body;
	try {
		body = await readJson(req);
	} catch (err) {
		return error(res, err.status ?? 400, 'bad_request', err.message);
	}

	const model = body?.model;
	if (!model || !FREE_MODELS.has(model))
		return error(res, 400, 'invalid_model', `Model not allowed. Use one of: ${[...FREE_MODELS].join(', ')}`);

	const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
			'Content-Type': 'application/json',
			'HTTP-Referer': 'https://three.ws',
			'X-Title': 'three.ws chat',
		},
		body: JSON.stringify(body),
	});

	res.statusCode = upstream.status;
	const ct = upstream.headers.get('content-type') ?? 'application/json';
	res.setHeader('content-type', ct);
	res.setHeader('cache-control', 'no-store');

	if (!upstream.body) {
		res.end(await upstream.text());
		return;
	}

	// Stream SSE response directly back to the browser
	const reader = upstream.body.getReader();
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			res.write(value);
		}
	} finally {
		res.end();
	}
});
