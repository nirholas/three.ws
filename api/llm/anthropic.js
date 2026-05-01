// We-pay LLM proxy: forwards Anthropic messages requests on behalf of an agent
// after enforcing embed-policy (brain.mode, origins, surfaces) and quota/rate limits.

import { z } from 'zod';
import { Redis } from '@upstash/redis';
import { env } from '../_lib/env.js';
import { cors, error, method, wrap, readJson, json } from '../_lib/http.js';
import { parse } from '../_lib/validate.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { recordEvent, logger } from '../_lib/usage.js';
import { readEmbedPolicy } from '../_lib/embed-policy.js';

const log = logger('llm.anthropic');

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
const FIRST_PARTY = ['three.ws', 'localhost'];

// Default per-agent monthly token budget when policy.brain.cost_limit_cents is unset.
const DEFAULT_MONTHLY_TOKEN_BUDGET = 1_000_000;
// Rough cents-per-token conversion when a cost budget is provided. Conservative
// blended estimate across input+output for the allowlisted models.
const CENTS_PER_1K_TOKENS = 1.5;

function tokenBudgetFromPolicy(policy) {
	const cents = policy?.brain?.cost_limit_cents;
	if (typeof cents === 'number' && cents > 0) {
		return Math.floor((cents / CENTS_PER_1K_TOKENS) * 1000);
	}
	return DEFAULT_MONTHLY_TOKEN_BUDGET;
}

function monthKey() {
	const now = new Date();
	return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

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

// Build the strict CORS allowlist: first-party origins + any origin the agent's
// embed policy declares. Returns an array of exact-match origin strings.
function buildCorsAllowlist(policy) {
	const out = new Set();
	if (env.APP_ORIGIN) out.add(env.APP_ORIGIN);
	try {
		if (env.ISSUER) out.add(env.ISSUER);
	} catch {
		// ISSUER derives from APP_ORIGIN; ignore if unset.
	}
	// Localhost for dev parity with the same-origin check above.
	const hosts = policy?.origins?.hosts ?? [];
	for (const h of hosts) {
		const lower = String(h).toLowerCase();
		if (lower.startsWith('*.')) {
			// Wildcard — convert to a regex matching https://<sub>.<base>.
			const base = lower.slice(2).replace(/[.+?^${}()|[\]\\]/g, '\\$&');
			out.add(new RegExp(`^https?://([a-z0-9-]+\\.)+${base}$`));
		} else {
			out.add(`https://${lower}`);
			out.add(`http://${lower}`);
		}
	}
	// Allow localhost only outside production, matching isAllowedOrigin's default.
	if (process.env.NODE_ENV !== 'production') {
		out.add(/^https?:\/\/localhost(:\d+)?$/);
	}
	return Array.from(out);
}

async function incrementMonthlyQuota(agentId) {
	const r = getRedis();
	if (!r) return 0; // no Redis → quota not enforced
	const key = `llm:quota:${agentId}:${monthKey()}`;
	const count = await r.incr(key);
	if (count === 1) await r.expire(key, 40 * 24 * 3600); // expire after 40 days
	return count;
}

// Peek at the current month's token total without incrementing. Returns 0 when
// Redis is unavailable (quota not enforced).
async function getMonthlyTokens(agentId) {
	const r = getRedis();
	if (!r) return 0;
	const key = `llm:tokens:${agentId}:${monthKey()}`;
	const v = await r.get(key);
	return typeof v === 'number' ? v : parseInt(v || '0', 10) || 0;
}

async function addMonthlyTokens(agentId, delta) {
	const r = getRedis();
	if (!r || !delta) return 0;
	const key = `llm:tokens:${agentId}:${monthKey()}`;
	const total = await r.incrby(key, delta);
	if (total === delta) await r.expire(key, 40 * 24 * 3600);
	return total;
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
	// Resolve the agent up front so CORS can use the agent's embed policy.
	const url = new URL(req.url, 'http://x');
	const agentId = url.searchParams.get('agent');

	// Load policy first (when possible) so CORS allowlist can include the
	// agent-declared origins. If no agent is supplied or not found, fall back
	// to first-party only — the preflight will then be rejected for unknown
	// third-party origins, which is the desired hardening.
	let policy = null;
	if (agentId) policy = await readEmbedPolicy(agentId);

	const corsOrigins = buildCorsAllowlist(policy);
	if (cors(req, res, { origins: corsOrigins, methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	if (!agentId) return error(res, 400, 'validation_error', 'agent query param required');
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

	// 5a. Monthly call-count quota (existing)
	const quota = policy.brain?.monthly_quota;
	if (typeof quota === 'number' && quota !== null) {
		const used = await incrementMonthlyQuota(agentId);
		if (used > quota) {
			return error(res, 429, 'quota_exceeded', `monthly quota of ${quota} calls reached`);
		}
	}

	// 5b. Monthly token budget (input+output). Check before forwarding; debit
	// the actual usage after the upstream response so we never under-count but
	// may serve one request that tips over — acceptable for a soft budget.
	const tokenBudget = tokenBudgetFromPolicy(policy);
	const tokensUsedSoFar = await getMonthlyTokens(agentId);
	if (tokensUsedSoFar >= tokenBudget) {
		return error(res, 429, 'quota_exceeded', `monthly token budget of ${tokenBudget} reached`);
	}

	// 6. Validate + normalize request body
	const rawBody = await readJson(req);
	const body = parse(bodySchema, rawBody);
	const model = body.model || policy.brain?.model || 'claude-opus-4-6';
	if (!MODEL_ALLOWLIST.has(model)) {
		return error(res, 400, 'validation_error', `model "${model}" not in allowlist`);
	}

	const isStreaming = body.stream === true;

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

	// 8a. Sanitize upstream errors before branching — do not forward Anthropic's error JSON.
	if (upstream.status >= 400) {
		const errText = await upstream.text();
		log.error('upstream_error', { agentId, model, status: upstream.status, body: errText.slice(0, 2000) });
		return json(res, 502, { error: 'upstream_error', status: upstream.status });
	}

	// 8b. Streaming path — pipe SSE chunks directly; extract token counts in-flight.
	if (isStreaming) {
		res.statusCode = upstream.status;
		res.setHeader('content-type', 'text/event-stream');
		res.setHeader('cache-control', 'no-cache');
		res.setHeader('x-accel-buffering', 'no');

		const reader = upstream.body.getReader();
		const decoder = new TextDecoder();
		let inputTokens = 0;
		let outputTokens = 0;
		let sseBuffer = '';

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				res.write(value);

				// Parse SSE lines for usage events without buffering the whole body.
				sseBuffer += decoder.decode(value, { stream: true });
				const lines = sseBuffer.split('\n');
				sseBuffer = lines.pop(); // keep the incomplete trailing line
				for (const line of lines) {
					if (!line.startsWith('data: ')) continue;
					try {
						const ev = JSON.parse(line.slice(6));
						if (ev.type === 'message_start') inputTokens = ev.message?.usage?.input_tokens ?? 0;
						if (ev.type === 'message_delta') outputTokens = ev.usage?.output_tokens ?? 0;
					} catch {
						// not every data line is JSON (e.g. [DONE]) — skip
					}
				}
			}
		} finally {
			res.end();
		}

		const latencyMs = Date.now() - t0;

		if (inputTokens || outputTokens) {
			try {
				await addMonthlyTokens(agentId, inputTokens + outputTokens);
			} catch (err) {
				log.warn('token_counter_write_failed', { agentId, msg: err?.message });
			}
		}

		recordEvent({
			kind: 'llm',
			tool: 'anthropic.messages',
			agentId,
			bytes: 0,
			latencyMs,
			status: 'ok',
			meta: { model, input_tokens: inputTokens, output_tokens: outputTokens, upstream_status: upstream.status },
		});

		return;
	}

	// 8c. Non-streaming path — buffer and parse as before.
	const upstreamText = await upstream.text();
	const latencyMs = Date.now() - t0;

	let upstreamJson = null;
	try {
		upstreamJson = JSON.parse(upstreamText);
	} catch {
		// Non-JSON body — treated as an opaque upstream failure below.
	}
	const inputTokens = upstreamJson?.usage?.input_tokens ?? 0;
	const outputTokens = upstreamJson?.usage?.output_tokens ?? 0;

	if (inputTokens || outputTokens) {
		try {
			await addMonthlyTokens(agentId, inputTokens + outputTokens);
		} catch (err) {
			log.warn('token_counter_write_failed', { agentId, msg: err?.message });
		}
	}

	// 9. Record usage (fire-and-forget)
	recordEvent({
		kind: 'llm',
		tool: 'anthropic.messages',
		agentId,
		bytes: upstreamText.length,
		latencyMs,
		status: 'ok',
		meta: {
			model,
			input_tokens: inputTokens,
			output_tokens: outputTokens,
			upstream_status: upstream.status,
		},
	});

	// 10. Proxy Anthropic's successful response faithfully (unchanged shape).
	res.statusCode = upstream.status;
	res.setHeader('content-type', upstream.headers.get('content-type') || 'application/json');
	return res.end(upstreamText);
});
