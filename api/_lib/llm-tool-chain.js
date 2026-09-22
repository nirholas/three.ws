// api/_lib/llm-tool-chain.js: the OpenAI-wire tool-calling LLM chain.
//
// Extracted verbatim from api/agents/copilot.js (where it was proven in
// production on the trading copilot) so every server-side tool loop: the
// copilot, the general agent loop at /api/agent/run: runs on the same lanes
// with the same failover semantics. Free platform keys lead, the paid OpenAI
// key is a backstop, and the credits-funded Vertex Gemini anchor is ALWAYS the
// final rung when the GCP project is set. Every provider speaks the OpenAI
// chat-completions wire format (tools + streamed tool_calls), so one reader
// handles them all.

import { env } from './env.js';
import { DEFAULT_FREE_MODEL, MODEL_CATALOG, resolveModelId } from './chat-models.js';
import {
	vertexGeminiAvailable,
	vertexGeminiModel,
	vertexGeminiChatUrl,
	vertexGeminiHeaders,
	vertexGeminiBudget,
} from './vertex-gemini.js';
import { rosterTransports } from './model-routes.js';

// ── provider chain (free-first, OpenAI-compatible tool-calling + streaming) ────
// Mirrors the platform policy in api/_lib/llm.js: free platform keys lead, the
// paid OpenAI key is appended last as a backstop. Every provider here speaks the
// OpenAI chat-completions wire format (tools + streamed tool_calls), so one
// reader handles them all. Anthropic is intentionally omitted from the tool loop
//: the free OpenAI-compatible lanes are the primary path and OpenAI is the paid
// tail; nothing here depends on a paid key existing. The credits-funded Vertex
// Gemini anchor is ALWAYS the final rung when the GCP project is set (api/chat.js
// semantics): the prod OPENAI_API_KEY is billing-dead, so without the anchor a
// simultaneous free-lane throttle 5xx'd the copilot. Exported for the anchor
// regression tests.
export function providerChain() {
	const chain = [];
	if (env.GROQ_API_KEY) {
		chain.push({ name: 'groq', url: 'https://api.groq.com/openai/v1/chat/completions', key: env.GROQ_API_KEY, model: 'qwen/qwen3.8-27b' });
	}
	// Same Llama 3.3 70B on Cerebras' free tier: a second independent quota pool
	// for the 70B class, so a throttled Groq does not take the whole class down.
	if (env.CEREBRAS_API_KEY) {
		chain.push({ name: 'cerebras', url: 'https://api.cerebras.ai/v1/chat/completions', key: env.CEREBRAS_API_KEY, model: 'llama-3.3-70b' });
	}
	// EVERY OpenRouter rung rides DEFAULT_FREE_MODEL, exactly like api/_lib/llm.js.
	// This lane used to send the PAID meta-llama/llama-3.3-70b-instruct on the
	// primary key and the retired meta-llama/llama-3.3-70b-instruct:free on the
	// fallbacks, so the rung either billed the platform key (against policy) or
	// 404'd on a dead model id. Both halves are the same fix: name the live free
	// model, and keep it in step with chat-models.js.
	const orKeys = [...new Set([env.OPENROUTER_API_KEY, ...(env.OPENROUTER_FALLBACK_KEYS || [])].filter(Boolean))];
	orKeys.forEach((key, i) => {
		chain.push({
			name: i === 0 ? 'openrouter' : `openrouter#${i + 1}`,
			url: 'https://openrouter.ai/api/v1/chat/completions',
			key,
			model: DEFAULT_FREE_MODEL,
			extraHeaders: { 'HTTP-Referer': 'https://three.ws', 'X-Title': 'three.ws' },
		});
	});
	if (env.NVIDIA_API_KEY) {
		chain.push({ name: 'nvidia', url: 'https://integrate.api.nvidia.com/v1/chat/completions', key: env.NVIDIA_API_KEY, model: 'nvidia/nemotron-3-super-120b-a12b' });
	}
	// Three more free lanes, same OpenAI wire format including tools + streamed
	// tool_calls: SambaNova (Llama 3.3 70B, own quota pool), Mistral (Experiment
	// tier, about 1B free tokens/month), and Z.AI's free GLM Flash lane.
	if (env.SAMBANOVA_API_KEY) {
		chain.push({ name: 'sambanova', url: 'https://api.sambanova.ai/v1/chat/completions', key: env.SAMBANOVA_API_KEY, model: 'Meta-Llama-3.3-70B-Instruct' });
	}
	if (env.MISTRAL_API_KEY) {
		chain.push({ name: 'mistral', url: 'https://api.mistral.ai/v1/chat/completions', key: env.MISTRAL_API_KEY, model: 'mistral-small-latest' });
	}
	if (env.ZAI_API_KEY) {
		chain.push({ name: 'zai', url: 'https://api.z.ai/api/paas/v4/chat/completions', key: env.ZAI_API_KEY, model: 'glm-4.7-flash' });
	}
	// Gemini Flash-Lite on the AI Studio free tier: an external free quota with
	// full OpenAI-compatible tool calling, so the loop still has a free rung left
	// when every Llama-class lane above is throttled at once.
	if (env.GEMINI_API_KEY) {
		chain.push({ name: 'gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', key: env.GEMINI_API_KEY, model: 'gemini-2.5-flash-lite' });
	}
	if (env.OPENAI_API_KEY) {
		chain.push({ name: 'openai', url: 'https://api.openai.com/v1/chat/completions', key: env.OPENAI_API_KEY, model: 'gpt-5.4-nano' });
	}
	// Vertex Gemini credits anchor: keyless (GCP OAuth token minted per request
	// via getHeaders; see api/_lib/vertex-gemini.js), OpenAI-compatible including
	// tools + streamed tool_calls, billed to platform credits. Appended at the
	// tail unconditionally when available so no present provider key can evict it.
	if (vertexGeminiAvailable()) {
		chain.push({
			name: 'vertex-gemini',
			url: vertexGeminiChatUrl(),
			key: null,
			model: vertexGeminiModel(),
			getHeaders: vertexGeminiHeaders,
		});
	}
	return chain;
}

// Stream one chat-completion round. Emits assistant content deltas via
// onContent; accumulates streamed tool_calls. Resolves { content, toolCalls }.
// Throws on transport / non-2xx so the caller can fail over to the next provider.
export async function streamRound(provider, { messages, tools, onContent, temperature = 0.4 }) {
	const body = {
		model: provider.model,
		max_tokens: 1024,
		temperature,
		stream: true,
		messages,
	};
	// Ask for the usage chunk only where the lane is known to accept the
	// option; an unknown field is a 400 on some OpenAI-compatible hosts, and a
	// 400 here would fail the rung over for no reason. Other lanes still get
	// their usage read when they volunteer it.
	if (USAGE_OPTION_LANES.has(baseLane(provider.name))) body.stream_options = { include_usage: true };
	// Gemini on a roster Vertex route reasons by default and bills that
	// reasoning against max_tokens without returning it; cap it and fund it on
	// top so the visible budget stays what the loop asked for.
	if (provider.name === 'vertex' && String(provider.model).startsWith('google/')) {
		const budget = vertexGeminiBudget(body.max_tokens);
		body.max_tokens = budget.max_tokens;
		body.extra_body = budget.extra_body;
	}
	if (Array.isArray(tools) && tools.length) { body.tools = tools; body.tool_choice = 'auto'; }
	// Keyless lanes (the Vertex Gemini credits anchor) mint their auth per request
	// via getHeaders; a token-exchange failure throws here and fails over to the
	// next provider exactly like a transport error.
	const headers = provider.getHeaders
		? { ...(await provider.getHeaders()), ...(provider.extraHeaders || {}) }
		: { 'content-type': 'application/json', authorization: `Bearer ${provider.key}`, ...(provider.extraHeaders || {}) };
	const resp = await fetch(provider.url, {
		method: 'POST',
		headers,
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(45_000),
	});
	if (!resp.ok || !resp.body) {
		const detail = await resp.text().catch(() => '');
		throw Object.assign(new Error(`${provider.name} ${resp.status}: ${detail.slice(0, 180)}`), { status: 502 });
	}
	const reader = resp.body.getReader();
	const decoder = new TextDecoder();
	let buf = '';
	let content = '';
	const toolCalls = []; // index → { id, name, args }
	let usage = null;
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		buf += decoder.decode(value, { stream: true });
		let nl;
		while ((nl = buf.indexOf('\n')) >= 0) {
			const line = buf.slice(0, nl).trim();
			buf = buf.slice(nl + 1);
			if (!line.startsWith('data:')) continue;
			const payload = line.slice(5).trim();
			if (payload === '[DONE]') { buf = ''; break; }
			let evt;
			try { evt = JSON.parse(payload); } catch { continue; }
			const u = evt.usage || evt.x_groq?.usage;
			if (u && typeof u === 'object') usage = readUsage(u);
			const delta = evt.choices?.[0]?.delta;
			if (!delta) continue;
			if (delta.content) { content += delta.content; onContent?.(delta.content); }
			if (Array.isArray(delta.tool_calls)) {
				for (const tc of delta.tool_calls) {
					const idx = tc.index ?? 0;
					if (!toolCalls[idx]) toolCalls[idx] = { id: tc.id || `call_${idx}`, name: '', args: '' };
					if (tc.id) toolCalls[idx].id = tc.id;
					if (tc.function?.name) toolCalls[idx].name = tc.function.name;
					if (tc.function?.arguments) toolCalls[idx].args += tc.function.arguments;
				}
			}
		}
	}
	return { content, toolCalls: toolCalls.filter(Boolean), usage };
}

// Lanes documented to accept `stream_options.include_usage` on their
// OpenAI-compatible endpoint.
const USAGE_OPTION_LANES = new Set(['openai', 'groq', 'openrouter', 'cerebras', 'nvidia', 'gemini', 'grok']);

function baseLane(name) {
	return String(name || '').split('#')[0];
}

function readUsage(u) {
	const input = Number(u.prompt_tokens ?? u.input_tokens);
	const output = Number(u.completion_tokens ?? u.output_tokens);
	const cost = Number(u.cost);
	return {
		input: Number.isFinite(input) ? input : 0,
		output: Number.isFinite(output) ? output : 0,
		reportedCostUsd: Number.isFinite(cost) ? cost : null,
	};
}

// OpenAI-compatible chat-completions endpoint per catalog provider. Anthropic
// ids are served through OpenRouter's mirror of the same model, because the
// tool loop speaks one wire format and the platform key for OpenRouter is the
// one that is funded.
const LANE_ENDPOINTS = {
	groq: { url: 'https://api.groq.com/openai/v1/chat/completions', key: () => env.GROQ_API_KEY },
	openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', key: () => env.OPENROUTER_API_KEY },
	nvidia: { url: 'https://integrate.api.nvidia.com/v1/chat/completions', key: () => env.NVIDIA_API_KEY },
	sambanova: { url: 'https://api.sambanova.ai/v1/chat/completions', key: () => env.SAMBANOVA_API_KEY },
	mistral: { url: 'https://api.mistral.ai/v1/chat/completions', key: () => env.MISTRAL_API_KEY },
	zai: { url: 'https://api.z.ai/api/paas/v4/chat/completions', key: () => env.ZAI_API_KEY },
	openai: { url: 'https://api.openai.com/v1/chat/completions', key: () => env.OPENAI_API_KEY },
	grok: { url: 'https://api.x.ai/v1/chat/completions', key: () => env.GROK_API_KEY },
};

/** The OpenRouter mirror id for a first-party Anthropic id: `claude-haiku-4-5-20251001` → `anthropic/claude-haiku-4.5`. */
export function anthropicMirrorId(model) {
	const bare = String(model).replace(/-\d{8}$/, '');
	return `anthropic/${bare.replace(/-(\d+)-(\d+)$/, '-$1.$2')}`;
}

/**
 * A single tool-loop rung that serves exactly `model`, or null when no
 * configured key can reach it. Used to honor an explicit model choice while
 * the free chain stays behind it as the failover. Roster models have several
 * rungs; this returns the first reachable one (modelRungs returns them all).
 * @param {string} model a MODEL_CATALOG id
 */
export function modelRung(model) {
	return modelRungs(model)[0] || null;
}

/**
 * Every tool-loop rung that serves exactly `model`, in failover order. A roster
 * model (model-roster.js) contributes one rung per reachable route; any other
 * catalog model contributes its single lane. Models without tool calling have
 * no rungs: the tool loop must never be pointed at them.
 * @param {string} requested a MODEL_CATALOG id (a retired id maps forward)
 */
export function modelRungs(requested) {
	const model = resolveModelId(requested);
	const meta = MODEL_CATALOG[model];
	if (!meta || !meta.tools) return [];
	if (meta.provider === 'roster') return rosterTransports(model);
	const rung = singleLaneRung(model, meta);
	return rung ? [rung] : [];
}

function singleLaneRung(model, meta) {
	if (!meta || !meta.tools) return null;
	if (meta.provider === 'anthropic') {
		if (!env.OPENROUTER_API_KEY) return null;
		return {
			name: 'openrouter',
			url: LANE_ENDPOINTS.openrouter.url,
			key: env.OPENROUTER_API_KEY,
			model: anthropicMirrorId(model),
			catalogModel: model,
			extraHeaders: { 'HTTP-Referer': 'https://three.ws', 'X-Title': 'three.ws' },
		};
	}
	const lane = LANE_ENDPOINTS[meta.provider];
	const key = lane?.key();
	if (!lane || !key) return null;
	const rung = { name: meta.provider, url: lane.url, key, model, catalogModel: model };
	if (meta.provider === 'openrouter') rung.extraHeaders = { 'HTTP-Referer': 'https://three.ws', 'X-Title': 'three.ws' };
	return rung;
}

/**
 * The provider chain for a request that may name a model: the named model's
 * rungs first (every route that serves it, in order), then the free-first
 * platform chain behind them, minus any rung that would repeat one of them.
 * @param {string|null} [model]
 */
export function providerChainFor(model) {
	const chain = providerChain();
	if (!model) return chain;
	const rungs = modelRungs(model);
	if (!rungs.length) return chain;
	const seen = new Set(rungs.map((r) => `${r.name}|${r.model}`));
	return [...rungs, ...chain.filter((p) => !seen.has(`${p.name}|${p.model}`))];
}

