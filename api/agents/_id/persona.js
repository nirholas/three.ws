// GET    /api/agents/:id/persona         — persona status (has_persona, tone_tags, extracted_at)
// POST   /api/agents/:id/persona/extract — extract persona from 5-question interview via Claude

import { createHash, createHmac } from 'node:crypto';
import { sql } from '../../_lib/db.js';
import { getSessionUser, authenticateBearer, extractBearer } from '../../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../../_lib/http.js';
import { limits } from '../../_lib/rate-limit.js';
import { env } from '../../_lib/env.js';
import { parse } from '../../_lib/validate.js';
import { z } from 'zod';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const extractBody = z.object({
	answers: z
		.array(z.string().trim().min(5, 'Each answer must be at least 5 characters').max(1000))
		.length(5, 'Exactly 5 answers required'),
});

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { userId: bearer.userId };
	return null;
}

const PERSONA_TOOL = {
	name: 'extract_persona',
	description: 'Extract a persona system prompt from interview answers',
	input_schema: {
		type: 'object',
		required: ['system_prompt', 'tone_tags', 'vocabulary_samples'],
		properties: {
			system_prompt: {
				type: 'string',
				description:
					'A 150-300 word first-person system prompt that captures the persona. Start with "You are ...".',
			},
			tone_tags: {
				type: 'array',
				items: { type: 'string' },
				description: 'Up to 8 single-word tone descriptors (e.g. witty, direct, empathetic).',
			},
			vocabulary_samples: {
				type: 'array',
				items: { type: 'string' },
				description: 'Up to 10 short phrases or expressions characteristic of this persona.',
			},
		},
	},
};

export const handlePersona = wrap(async (req, res, id, action) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');

	const [agent] =
		await sql`SELECT id, user_id FROM agent_identities WHERE id = ${id} AND deleted_at IS NULL`;
	if (!agent) return error(res, 404, 'not_found', 'agent not found');
	if (agent.user_id !== auth.userId) return error(res, 403, 'forbidden', 'not your agent');

	// ── GET — persona status ─────────────────────────────────────────────────

	if (req.method === 'GET') {
		const [row] = await sql`
			SELECT persona_prompt_hash, persona_tone_tags, persona_extracted_at
			FROM agent_identities WHERE id = ${id}
		`;
		return json(res, 200, {
			has_persona: Boolean(row?.persona_prompt_hash),
			tone_tags: row?.persona_tone_tags || [],
			extracted_at: row?.persona_extracted_at || null,
		});
	}

	// ── POST /extract ─────────────────────────────────────────────────────────

	if (req.method === 'POST' && action === 'extract') {
		const rl = await limits.personaExtract(auth.userId);
		if (!rl.success)
			return error(res, 429, 'rate_limited', 'persona extraction limit reached (5 per day)');

		const body = parse(extractBody, await readJson(req));
		const { answers } = body;

		const apiKey = env.ANTHROPIC_API_KEY;

		let upstream;
		try {
			upstream = await fetch(ANTHROPIC_URL, {
				method: 'POST',
				headers: {
					'x-api-key': apiKey,
					'anthropic-version': '2023-06-01',
					'content-type': 'application/json',
				},
				body: JSON.stringify({
					model: 'claude-sonnet-4-6',
					max_tokens: 1024,
					system:
						'You are a persona architect. Given a person\'s interview answers, extract their communication style, tone, and voice. Produce a concise first-person system prompt that an LLM can use to impersonate this person faithfully. Be specific. Avoid clichés.',
					messages: [
						{
							role: 'user',
							content: `Interview answers:\n1. ${answers[0]}\n2. ${answers[1]}\n3. ${answers[2]}\n4. ${answers[3]}\n5. ${answers[4]}`,
						},
					],
					tools: [PERSONA_TOOL],
					tool_choice: { type: 'tool', name: 'extract_persona' },
				}),
			});
		} catch (err) {
			console.error('[persona/extract] anthropic fetch failed', err);
			return error(res, 502, 'upstream_error', 'persona extraction service unreachable');
		}

		if (!upstream.ok) {
			const text = await upstream.text().catch(() => '');
			console.error('[persona/extract] anthropic error', upstream.status, text.slice(0, 400));
			return error(res, 502, 'upstream_error', `persona extraction failed (${upstream.status})`);
		}

		const data = await upstream.json();
		const toolUse = data.content?.find(
			(b) => b.type === 'tool_use' && b.name === 'extract_persona',
		);
		if (!toolUse?.input) {
			console.error('[persona/extract] no tool_use block', JSON.stringify(data).slice(0, 400));
			return error(res, 502, 'upstream_error', 'unexpected response from persona extraction');
		}

		const { system_prompt, tone_tags, vocabulary_samples } = toolUse.input;

		const hash = createHash('sha256').update(system_prompt).digest('hex');
		const sig = createHmac('sha256', env.JWT_SECRET).update(hash).digest('hex');

		const [updated] = await sql`
			UPDATE agent_identities
			SET
				persona_prompt        = ${system_prompt},
				persona_prompt_hash   = ${hash},
				persona_prompt_sig    = ${sig},
				persona_tone_tags     = ${JSON.stringify(tone_tags)}::jsonb,
				persona_extracted_at  = now(),
				updated_at            = now()
			WHERE id = ${id}
			RETURNING persona_extracted_at
		`;

		return json(res, 200, {
			system_prompt,
			tone_tags,
			vocabulary_samples,
			hash,
			extracted_at: updated.persona_extracted_at,
		});
	}

	return error(res, 404, 'not_found', 'unknown persona action');
});
