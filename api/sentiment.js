// POST /api/sentiment
// body: { text: string }
// → { sentiment: 'Positive' | 'Negative' | 'Neutral' }
// Backs the analyze-sentiment skill in src/agent-skills-sentiment.js.
// Deterministic lexicon scorer — same one used by /api/social/sentiment.

import { cors, json, method, readJson, wrap, error } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { scoreSentiment } from '../src/social/sentiment.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: false })) return;
	if (!method(req, res, ['POST'])) return;

	const rl = await limits.publicIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	let body;
	try {
		body = await readJson(req);
	} catch {
		return error(res, 400, 'validation_error', 'invalid json');
	}

	const text = typeof body?.text === 'string' ? body.text.trim() : '';
	if (!text) return error(res, 400, 'validation_error', '"text" must be a non-empty string');

	const result = scoreSentiment([{ text }]);
	let sentiment;
	if (result.posPct > 0 && result.posPct >= result.negPct) sentiment = 'Positive';
	else if (result.negPct > 0) sentiment = 'Negative';
	else sentiment = 'Neutral';

	return json(res, 200, { sentiment, score: result.score });
});
