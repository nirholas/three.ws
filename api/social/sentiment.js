// POST /api/social/sentiment
// body: { posts: [{ id?, ts?, text, author? }, ...] }
// → { score, posPct, negPct, neuPct, count, examples }
// No auth required. Rate-limited by IP.

import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { z } from 'zod';

const postSchema = z.object({
	id: z.string().optional(),
	ts: z.union([z.string(), z.number()]).optional(),
	text: z.string(),
	author: z.string().optional(),
});

const bodySchema = z.object({
	posts: z.array(postSchema).min(1).max(500),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: false })) return;
	if (!method(req, res, ['POST'])) return;

	const rl = await limits.mcpIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	let raw;
	try {
		raw = await readJson(req);
	} catch {
		return error(res, 400, 'validation_error', 'invalid json');
	}

	const parsed = bodySchema.safeParse(raw);
	if (!parsed.success) {
		return error(res, 400, 'validation_error', parsed.error.issues[0]?.message ?? 'invalid body');
	}

	const { scoreSentiment } = await import('../../src/social/sentiment.js');
	const result = scoreSentiment(parsed.data.posts);
	return json(res, 200, result);
});
