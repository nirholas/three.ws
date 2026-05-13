// POST /api/x/draft — generate a tweet draft using Claude based on the agent's
// profile (name + description). Returns a single 280-char proposal that the
// user can edit before posting.

import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { cors, method, wrap, error, readJson, json } from '../_lib/http.js';
import { env } from '../_lib/env.js';

const MAX_TWEET_LEN = 280;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const body = await readJson(req);
	const agentId = typeof body?.agent_id === 'string' ? body.agent_id : null;
	const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';

	let agentContext = '';
	if (agentId) {
		const rows = await sql`select id, name, description from avatars where id = ${agentId} limit 1`;
		const a = rows[0];
		if (a) agentContext = `Agent name: ${a.name || 'Unnamed'}\nAgent description: ${a.description || '(none)'}`;
	}

	const system = `You write tweets for AI agents on three.ws. Tweets must be:
- Under ${MAX_TWEET_LEN} characters (hard limit).
- In the agent's voice (first person, matching the description).
- No hashtag spam. At most 1 hashtag.
- No leading/trailing quotes. Plain text only.
- Avoid em-dashes.
Output ONLY the tweet text, nothing else.`;

	const userPrompt = [
		agentContext,
		prompt ? `What to post about: ${prompt}` : 'Write something engaging about being an autonomous AI agent.',
	].filter(Boolean).join('\n\n');

	const upstream = await fetch('https://api.anthropic.com/v1/messages', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'anthropic-version': '2023-06-01',
			'x-api-key': env.ANTHROPIC_API_KEY,
		},
		body: JSON.stringify({
			model: 'claude-haiku-4-5-20251001',
			max_tokens: 200,
			system,
			messages: [{ role: 'user', content: userPrompt }],
		}),
	});

	if (!upstream.ok) {
		const detail = await upstream.text();
		console.error('[x-draft] LLM failed', upstream.status, detail);
		return error(res, 502, 'llm_failed', 'draft generation failed');
	}

	const data = await upstream.json();
	let text = (data.content?.[0]?.text || '').trim();
	if (text.startsWith('"') && text.endsWith('"')) text = text.slice(1, -1).trim();
	if (text.length > MAX_TWEET_LEN) text = text.slice(0, MAX_TWEET_LEN - 1) + '…';

	return json(res, 200, { text, length: text.length });
});
