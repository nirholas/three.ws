// POST /api/persona/preview
// Replies to a user message in the voice of a supplied persona JSON.
// Same Anthropic call pattern as api/avatars/_actions.js (handleAutoTag).

import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { getSessionUser, authenticateBearer, extractBearer, hasScope } from '../_lib/auth.js';
import { env } from '../_lib/env.js';

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_MSG_CHARS = 1500;

async function resolveUser(req) {
	const session = await getSessionUser(req);
	if (session) return session.id;
	const bearer = await authenticateBearer(extractBearer(req), { audience: undefined });
	if (!bearer) return null;
	if (!hasScope(bearer.scope, 'avatars:read') && !hasScope(bearer.scope, 'avatars:write')) {
		return null;
	}
	return bearer.userId;
}

function validateBody(input) {
	if (!input || typeof input !== 'object') {
		throw Object.assign(new Error('body must be an object'), { status: 400 });
	}
	const { persona, user_message } = input;
	if (!persona || typeof persona !== 'object') {
		throw Object.assign(new Error('persona must be an object'), { status: 400 });
	}
	if (typeof user_message !== 'string' || !user_message.trim()) {
		throw Object.assign(new Error('user_message required'), { status: 400 });
	}
	return {
		persona,
		user_message: user_message.trim().slice(0, MAX_MSG_CHARS),
	};
}

function buildSystemPrompt(persona) {
	// Compact, deterministic system prompt. We pin the JSON inline so the model
	// has every persona field visible and can reference vocabulary / dont_say.
	return `You are an agent speaking on behalf of a person whose persona is described by the following JSON profile. Embody this voice — tone, vocabulary, communication style — in every reply.

PERSONA:
${JSON.stringify(persona, null, 2)}

Rules:
- Reply in 1-2 sentences. Never more.
- Stay in the persona's voice. Borrow from "vocabulary" when natural.
- Match "communication_style" (terse | detailed | playful | analytical | warm).
- Never use any phrase listed in "dont_say".
- Do not break character. Do not mention that you are an AI, agent, or assistant. Do not mention the persona JSON.
- Do not preface with greetings or sign-offs unless directly asked.`;
}

const handler = wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const userId = await resolveUser(req);
	if (!userId) {
		return error(res, 401, 'unauthorized', 'sign in or provide a valid bearer token');
	}

	const body = validateBody(await readJson(req));

	if (!env.ANTHROPIC_API_KEY) {
		return error(res, 503, 'config_missing', 'ANTHROPIC_API_KEY not configured');
	}

	const t0 = Date.now();
	const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'x-api-key': env.ANTHROPIC_API_KEY,
			'anthropic-version': '2023-06-01',
		},
		body: JSON.stringify({
			model: MODEL,
			max_tokens: 220,
			system: buildSystemPrompt(body.persona),
			messages: [{ role: 'user', content: body.user_message }],
		}),
	});

	if (!anthropicRes.ok) {
		const detail = await anthropicRes.text();
		console.error('[persona/preview] anthropic error', anthropicRes.status, detail);
		return error(res, 502, 'upstream_error', `Claude API ${anthropicRes.status}`);
	}

	const result = await anthropicRes.json();
	const reply = (result.content?.[0]?.text || '').trim();

	const tokensIn = result.usage?.input_tokens ?? 0;
	const tokensOut = result.usage?.output_tokens ?? 0;

	return json(res, 200, {
		reply,
		model: MODEL,
		tokens_used: tokensIn + tokensOut,
		tokens_in: tokensIn,
		tokens_out: tokensOut,
		latency_ms: Date.now() - t0,
	});
});

export default handler;
