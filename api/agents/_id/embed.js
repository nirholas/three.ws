// POST /api/agents/:id/embed
// Generates a text embedding via Voyage AI (voyage-3-lite, 1024-dim).
// Used by AgentMemory.recall() for semantic similarity search.

import { getSessionUser, authenticateBearer, extractBearer } from '../../_lib/auth.js';
import { cors, json, method, readJson, error } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { env } from '../../_lib/env.js';

const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';

export async function handleEmbed(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const session = await getSessionUser(req);
	const bearer = session ? null : await authenticateBearer(extractBearer(req));
	if (!session && !bearer) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = await readJson(req);
	const text = body?.text;
	if (!text || typeof text !== 'string' || !text.trim()) {
		return error(res, 400, 'validation_error', 'text is required');
	}
	if (text.length > 8192) {
		return error(res, 400, 'validation_error', 'text exceeds 8192 character limit');
	}

	const upstream = await fetch(VOYAGE_URL, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${env.VOYAGE_API_KEY}`,
		},
		body: JSON.stringify({
			model: 'voyage-3-lite',
			input: [text.trim()],
			input_type: 'query',
		}),
	});

	if (!upstream.ok) {
		const msg = await upstream.text().catch(() => '');
		console.error('[embed] voyage error', upstream.status, msg.slice(0, 200));
		return error(res, 502, 'upstream_error', 'embedding service unavailable');
	}

	const data = await upstream.json();
	const embedding = data?.data?.[0]?.embedding;
	if (!Array.isArray(embedding)) {
		return error(res, 502, 'upstream_error', 'unexpected embedding response shape');
	}

	return json(res, 200, { embedding });
}
