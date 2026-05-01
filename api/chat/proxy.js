import { env } from '../_lib/env.js';
import { cors, error, json, method, wrap, readJson } from '../_lib/http.js';

const UPGRADE_URL = `${env.APP_ORIGIN}/pricing`;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	if (!env.OPENROUTER_API_KEY)
		return error(res, 503, 'not_configured', 'Built-in model not available');

	let body;
	try {
		body = await readJson(req);
	} catch (err) {
		return error(res, err.status ?? 400, 'bad_request', err.message);
	}

	const model = body?.model;
	// Only allow free-tier OpenRouter models to prevent abuse.
	if (!model || !model.endsWith(':free'))
		return error(res, 400, 'invalid_model', 'Only free-tier models (ending in :free) are allowed via the built-in proxy');

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

	if (upstream.status === 402) {
		const upstreamBody = await upstream.text();
		const reason = /no_credits|insufficient/i.test(upstreamBody) ? 'no_credits' : 'plan_required';
		return json(res, 402, {
			error: 'payment_required',
			error_description: 'Built-in model requires a funded plan',
			reason,
			upgradeUrl: UPGRADE_URL,
		});
	}

	if (upstream.status === 429) {
		const upstreamRetry = parseInt(upstream.headers.get('retry-after') ?? '', 10);
		const retryAfter = Number.isFinite(upstreamRetry) && upstreamRetry > 0 ? upstreamRetry : 30;
		res.setHeader('retry-after', String(retryAfter));
		return json(res, 429, {
			error: 'rate_limited',
			error_description: 'Upstream provider rate limited the request',
			retryAfter,
			scope: 'agent',
		});
	}

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
