// We-pay LLM proxy: forwards Anthropic messages requests on behalf of an agent
// after enforcing embed-policy (brain.mode, origins, surfaces) and quota/rate limits.

import { z } from 'zod';
import { Redis } from '@upstash/redis';
import { env } from '../_lib/env.js';
import { cors, error, method, wrap, readJson } from '../_lib/http.js';
import { parse } from '../_lib/validate.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { recordEvent } from '../_lib/usage.js';
import { readEmbedPolicy } from '../_lib/embed-policy.js';

// ── Redis client (for monthly quota counters) ────────────────────────────────

let _redis = null;
function getRedis() {
	if (!_redis && env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
		_redis = new Redis({
			url: env.UPSTASH_REDIS_REST_URL,
			token: env.UPSTASH_REDIS_REST_TOKEN,
		});
	}
	return _redis;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const MODEL_ALLOWLIST = new Set([
	'claude-opus-4-6',
	'claude-opus-4-7',
	'claude-sonnet-4-6',
	'claude-haiku-4-5-20251001',
]);

// First-party hostnames always pass origin checks (same as element.js).
const FIRST_PARTY = ['3dagent.vercel.app', 'localhost'];

function originAllowed(originHeader, policy) {
	if (!originHeader) return true; // server-to-server / curl — allow
	let host;
	try {
		host = new URL(originHeader).hostname.toLowerCase();
	} catch {
		return false;
	}
	if (FIRST_PARTY.some((fp) => host === fp || host.endsWith('.' + fp))) return true;
	const hosts = policy?.origins?.hosts ?? [];
	const mode = policy?.origins?.mode ?? 'allowlist';
	const matches = hosts.some((h) => {
		const lower = h.toLowerCase();
		if (lower.startsWith('*.')) return host.endsWith(lower.slice(1)) && host !== lower.slice(2);
		return host === lower;
	});
	return mode === 'allowlist' ? matches : !matches;
}

async function incrementMonthlyQuota(agentId) {
	const r = getRedis();
	if (!r) return 0; // no Redis → quota not enforced
	const now = new Date();
	const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
	const key = `llm:quota:${agentId}:${ym}`;
	const count = await r.incr(key);
	if (count === 1) await r.expire(key, 40 * 24 * 3600); // expire after 40 days
	return count;
}

// ── Request schema ────────────────────────────────────────────────────────────

const messageContentSchema = z.union([
	z.string(),
	z.array(z.any()), // Anthropic content blocks; pass through
]);

const bodySchema = z.object({
	system: z.string().max(64_000).optional(),
	messages: z
		.array(
			z.object({
				role: z.enum(['user', 'assistant']),
				content: messageContentSchema,
			}),
		)
		.min(1)
		.max(200),
	tools: z.array(z.any()).max(64).optional(),
	model: z.string().max(100).optional(),
	max_tokens: z.number().int().positive().max(16_000).optional(),
	temperature: z.number().min(0).max(2).optional(),
	thinking: z.any().optional(),
});

// ── Handler ───────────────────────────────────────────────────────────────────

export default wrap(async (req, res) => {
	// Allow all HTTP origins for CORS — policy is enforced server-side below.
	if (cors(req, res, { origins: [/^https?:\/\/.+/], methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	const url = new URL(req.url, 'http://x');
	const agentId = url.searchParams.get('agent');
	if (!agentId) return error(res, 400, 'validation_error', 'agent query param required');

	// 1. Read embed policy
	const policy = await readEmbedPolicy(agentId);
	if (!policy) return error(res, 404, 'not_found', 'agent not found');

	if (policy.brain?.mode !== 'we-pay') {
		return error(
			res,
			402,
			'payment_required',
			`brain.mode is "${policy.brain?.mode ?? 'unset'}"; caller must supply its own key or proxy`,
		);
	}

	if (policy.surfaces?.script === false) {
		return error(res, 403, 'embed_denied_surface', 'script surface disabled for this agent');
	}

	// 2. Origin / Referer check
	const originHeader = req.headers.origin || req.headers.referer || '';
	if (!originAllowed(originHeader, policy)) {
		return error(
			res,
			403,
			'embed_denied_origin',
			"origin not permitted by this agent's embed policy",
		);
	}

	// 3. Per-IP rate limit
	const ipRl = await limits.embedLlmIp(clientIp(req));
	if (!ipRl.success) return error(res, 429, 'rate_limited', 'too many requests from this IP');

	// 4. Per-agent rate limit (dynamic, from policy)
	const perMin = policy.brain?.rate_limit_per_min;
	if (perMin && perMin > 0) {
		const agentRl = await limits.embedLlmAgent(agentId, perMin);
		if (!agentRl.success) return error(res, 429, 'rate_limited', 'agent rate limit exceeded');
	}

	// 5. Monthly quota check
	const quota = policy.brain?.monthly_quota;
	if (typeof quota === 'number' && quota !== null) {
		const used = await incrementMonthlyQuota(agentId);
		if (used > quota) {
			return error(res, 429, 'quota_exceeded', `monthly quota of ${quota} calls reached`);
		}
	}

	// 6. Validate + normalize request body
	const rawBody = await readJson(req);
	const body = parse(bodySchema, rawBody);
	const model = body.model || policy.brain?.model || 'claude-opus-4-6';
	if (!MODEL_ALLOWLIST.has(model)) {
		return error(res, 400, 'validation_error', `model "${model}" not in allowlist`);
	}

	// 7. Forward to Anthropic
	const t0 = Date.now();
	const upstream = await fetch('https://api.anthropic.com/v1/messages', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'anthropic-version': '2023-06-01',
			'x-api-key': env.ANTHROPIC_API_KEY,
		},
		body: JSON.stringify({ ...body, model }),
	});
	const upstreamText = await upstream.text();
	const latencyMs = Date.now() - t0;

	// 8. Record usage (fire-and-forget)
	recordEvent({
		kind: 'llm',
		tool: 'anthropic.messages',
		agentId,
		bytes: upstreamText.length,
		latencyMs,
		status: upstream.ok ? 'ok' : 'error',
		meta: { model },
	});

	// 9. Proxy Anthropic's response faithfully
	res.statusCode = upstream.status;
	res.setHeader('content-type', upstream.headers.get('content-type') || 'application/json');
	return res.end(upstreamText);
});
