// POST /api/x/post — publish a tweet immediately. Body: { text, agent_id? }
// Quota, dedup, and token-refresh logic live in api/_lib/x-post.js.

import { getSessionUser } from '../_lib/auth.js';
import { cors, method, wrap, error, readJson, json } from '../_lib/http.js';
import { publishTweet, XPostError } from '../_lib/x-post.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const body = await readJson(req);
	const text = typeof body?.text === 'string' ? body.text : '';
	const agentId = typeof body?.agent_id === 'string' ? body.agent_id : null;

	try {
		const result = await publishTweet({ userId: user.id, agentId, text });
		return json(res, 200, result);
	} catch (err) {
		if (err instanceof XPostError) return error(res, err.status, err.code, err.message, err.extra);
		console.error('[x-post] unexpected error', err);
		return error(res, 500, 'internal_error', err.message || 'post failed');
	}
});
