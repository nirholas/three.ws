// POST /api/seed/synthesize
//
// Takes the raw connector payloads from the three.ws memory-seeding demo
// (any subset of github / x / farcaster) and asks Claude Haiku to write a
// 200-300 word memory seed — a markdown blob describing the user's likely
// interests, expertise, voice, and recent activity. This is what the
// agent's vector store would be seeded with on first sign-in.
//
// Auth: session OR bearer token. Mirrors the shape of api/avatars/_actions.js
// handleAutoTag for the Anthropic call.

import { z } from 'zod';
import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { parse } from '../_lib/validate.js';
import { getSessionUser, authenticateBearer, extractBearer } from '../_lib/auth.js';
import { env } from '../_lib/env.js';
import { limits, clientIp } from '../_lib/rate-limit.js';

const bodySchema = z
	.object({
		connectors: z
			.object({
				github: z.unknown().optional(),
				x: z.unknown().optional(),
				farcaster: z.unknown().optional(),
			})
			.refine(
				(c) => c.github || c.x || c.farcaster,
				{ message: 'at least one connector payload required' },
			),
	})
	.strict();

const SYSTEM_PROMPT = `You are the memory-synthesis component of three.ws — a service that builds long-term context for personal AI agents. Given one or more public-profile snapshots from a user's connected accounts, write a single markdown "memory seed" the agent should ingest as durable context.

Constraints:
- 200-300 words.
- Markdown, with at most three short sections (Interests, Voice, Recent activity) or a tight prose paragraph if that reads more naturally.
- Write in third person ("They build…", not "I build…").
- Ground every claim in the supplied data; mark genuine uncertainty with "likely" or "appears to".
- Do NOT include URLs, follower counts, or raw metrics — turn them into qualitative signals.
- Do NOT mention the source platform names; refer to "their public footprint" instead.
- No preamble, no closing — output only the markdown body of the seed.`;

function summarizeConnector(name, data) {
	if (!data || typeof data !== 'object') return null;
	if (data.ok === false) return null;
	// Compact representation — we strip noisy fields so Haiku focuses on signal.
	if (name === 'github') {
		return {
			handle: data.handle,
			name: data.name,
			bio: data.bio,
			location: data.location,
			company: data.company,
			public_repos: data.public_repos,
			top_repos: (data.top_repos || []).slice(0, 8).map((r) => ({
				name: r.name,
				description: r.description,
				stars: r.stars,
				language: r.language,
			})),
			top_readme_excerpt: (data.top_readme_excerpt || '').slice(0, 1200),
		};
	}
	if (name === 'x') {
		return {
			handle: data.handle,
			name: data.name,
			bio: data.bio,
			location: data.location,
			follower_count: data.follower_count,
			top_topics: data.top_topics,
			recent_tweets: (data.recent_tweets || [])
				.slice(0, 20)
				.map((t) => t.text)
				.filter(Boolean),
		};
	}
	if (name === 'farcaster') {
		return {
			handle: data.handle,
			fid: data.fid,
			display_name: data.display_name,
			bio: data.bio,
			follower_count: data.follower_count,
			recent_casts: (data.recent_casts || [])
				.slice(0, 20)
				.map((c) => c.text)
				.filter(Boolean),
		};
	}
	return null;
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const session = await getSessionUser(req);
	const bearer = session ? null : await authenticateBearer(extractBearer(req));
	const userId = session?.id ?? bearer?.userId ?? null;
	if (!userId)
		return error(res, 401, 'unauthorized', 'sign in or provide a valid bearer token');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many synthesis requests');

	const body = parse(bodySchema, await readJson(req));

	const sources = {};
	const sourcesUsed = [];
	for (const name of ['github', 'x', 'farcaster']) {
		const summary = summarizeConnector(name, body.connectors[name]);
		if (summary) {
			sources[name] = summary;
			sourcesUsed.push(name);
		}
	}

	if (!sourcesUsed.length)
		return error(res, 400, 'no_signal', 'no usable connector payloads supplied');

	const userMessage =
		`Public-footprint snapshots from ${sourcesUsed.length} connected ` +
		`${sourcesUsed.length === 1 ? 'account' : 'accounts'}:\n\n` +
		JSON.stringify(sources, null, 2);

	const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'x-api-key': env.ANTHROPIC_API_KEY,
			'anthropic-version': '2023-06-01',
		},
		body: JSON.stringify({
			model: 'claude-haiku-4-5-20251001',
			max_tokens: 1024,
			system: SYSTEM_PROMPT,
			messages: [{ role: 'user', content: userMessage }],
		}),
	});

	if (!anthropicRes.ok) {
		const detail = await anthropicRes.text().catch(() => '');
		console.error('[seed/synthesize] anthropic error', anthropicRes.status, detail.slice(0, 400));
		return error(res, 502, 'upstream_error', `synthesis failed (${anthropicRes.status})`);
	}

	const result = await anthropicRes.json();
	const memorySeed = (result.content || [])
		.filter((b) => b.type === 'text')
		.map((b) => b.text)
		.join('\n')
		.trim();

	if (!memorySeed)
		return error(res, 502, 'empty_synthesis', 'model returned no text content');

	const usage = result.usage || {};
	const tokensUsed = (usage.input_tokens || 0) + (usage.output_tokens || 0);

	return json(res, 200, {
		ok: true,
		memory_seed: memorySeed,
		sources_used: sourcesUsed,
		tokens_used: tokensUsed,
		usage: {
			input_tokens: usage.input_tokens || 0,
			output_tokens: usage.output_tokens || 0,
		},
		model: result.model || 'claude-haiku-4-5-20251001',
	});
});
