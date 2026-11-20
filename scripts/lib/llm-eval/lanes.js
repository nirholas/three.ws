// Lanes for the LLM eval: one fixed model behind one endpoint, so a score
// belongs to a model and not to whichever fallback rung happened to answer.
//
// `current` is the model production served most for these tasks over the last
// seven days (usage_events, measured 2026-11-20: NVIDIA Nemotron 3 Ultra led
// the forge director, X replies, agent spec and agent chat). The two Grok lanes
// read their ids from chat-models.js: the flagship (GROK_DEFAULT_MODEL) and the
// platform's budget Grok (GROK_BUDGET_MODEL, reasoning off as production runs it).
//
//   callLane(lane, request, { env, fetchImpl }) ->
//     { ok, status, text, toolCalls, usage, latencyMs, costMicro, error }

import { NVIDIA_ULTRA_MODEL } from '../../../api/_lib/llm.js';
import { GROK_DEFAULT_MODEL, GROK_BUDGET_MODEL, GROK_BUDGET_EXTRA_BODY, XAI_CHAT_COMPLETIONS_URL } from '../../../api/_lib/chat-models.js';
import { costMicroUsd } from '../../../api/_lib/llm-pricing.js';
import { normalizeXaiUsage } from '../../../api/_lib/xai-usage.js';
import { priceTableCostMicro } from '../../../api/_lib/xai-pricing.js';

const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

export const LANES = Object.freeze({
	current: Object.freeze({
		name: 'current',
		label: 'Nemotron 3 Ultra (production today)',
		provider: 'nvidia',
		model: NVIDIA_ULTRA_MODEL,
		url: NVIDIA_URL,
		keyEnvs: ['NVIDIA_API_KEY'],
		// Production sends this on every NIM rung: with thinking on, Nemotron
		// spends the budget on reasoning and returns an empty reply.
		extraBody: { chat_template_kwargs: { enable_thinking: false } },
	}),
	grok: Object.freeze({
		name: 'grok',
		label: `Grok flagship (${GROK_DEFAULT_MODEL})`,
		provider: 'grok',
		model: GROK_DEFAULT_MODEL,
		url: XAI_CHAT_COMPLETIONS_URL,
		keyEnvs: ['GROK_API_KEY', 'XAI_API_KEY'],
		extraBody: null,
	}),
	grok_budget: Object.freeze({
		name: 'grok_budget',
		label: `Grok budget (${GROK_BUDGET_MODEL}, reasoning off)`,
		provider: 'grok',
		model: GROK_BUDGET_MODEL,
		url: XAI_CHAT_COMPLETIONS_URL,
		keyEnvs: ['GROK_API_KEY', 'XAI_API_KEY'],
		extraBody: { ...GROK_BUDGET_EXTRA_BODY },
	}),
});

export function laneKey(lane, env = process.env) {
	for (const k of lane.keyEnvs) if (env[k]) return env[k];
	return null;
}

/** The OpenAI-compatible request body a lane sends for one task request. PURE. */
export function laneBody(lane, req) {
	return {
		model: lane.model,
		messages: [
			{ role: 'system', content: req.system },
			{ role: 'user', content: req.user },
		],
		max_tokens: req.maxTokens,
		...(req.tools ? { tools: req.tools, tool_choice: 'auto' } : {}),
		...(lane.extraBody || {}),
	};
}

/** Read text, tool calls and usage out of a chat-completions response. PURE. */
export function parseCompletion(data) {
	const msg = data?.choices?.[0]?.message || {};
	const toolCalls = (msg.tool_calls || []).map((c) => ({ name: c.function?.name, args: c.function?.arguments ?? '' })).filter((c) => c.name);
	return { text: typeof msg.content === 'string' ? msg.content : '', toolCalls, finish: data?.choices?.[0]?.finish_reason ?? null };
}

/**
 * Cost of one call in micro-USD. Grok: the cost xAI reports (cost_in_usd_ticks)
 * when present, else the xAI price table. Others: production's own pricing
 * (free NIM lanes price to 0). PURE.
 */
export function laneCostMicro(lane, usage) {
	if (lane.provider === 'grok') {
		const u = normalizeXaiUsage(usage);
		return u.costMicro ?? priceTableCostMicro(lane.model, u);
	}
	return costMicroUsd({ provider: lane.provider, model: lane.model, input: usage?.prompt_tokens ?? 0, output: usage?.completion_tokens ?? 0 });
}

/**
 * Send one request. Never throws: a network error, timeout or non-2xx comes
 * back as { ok: false, status, error } so the harness records it and moves on.
 * With no key the request is still sent without one, which proves the endpoint
 * and body shape against the provider's documented 401.
 */
export async function callLane(lane, req, { env = process.env, fetchImpl = fetch } = {}) {
	const key = laneKey(lane, env);
	const headers = { 'content-type': 'application/json' };
	if (key) headers.authorization = `Bearer ${key}`;
	const started = Date.now();
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), Math.max(req.timeoutMs || 30_000, 60_000));
	try {
		const res = await fetchImpl(lane.url, { method: 'POST', headers, body: JSON.stringify(laneBody(lane, req)), signal: ctrl.signal });
		const latencyMs = Date.now() - started;
		const raw = await res.text();
		let data = null;
		try {
			data = JSON.parse(raw);
		} catch {
			data = null;
		}
		if (!res.ok) {
			const detail = data?.error?.message || data?.error || data?.detail || raw;
			return { ok: false, status: res.status, latencyMs, error: String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 300), retryAfter: res.headers.get('retry-after') };
		}
		const parsed = parseCompletion(data);
		return { ok: true, status: res.status, latencyMs, ...parsed, usage: data?.usage ?? null, costMicro: laneCostMicro(lane, data?.usage), responseId: data?.id ?? null };
	} catch (err) {
		return { ok: false, status: 0, latencyMs: Date.now() - started, error: err?.name === 'AbortError' ? 'timeout' : String(err?.message || err).slice(0, 300) };
	} finally {
		clearTimeout(timer);
	}
}
