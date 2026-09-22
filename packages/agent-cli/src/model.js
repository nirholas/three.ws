// The model: one streaming round against any OpenAI-compatible
// chat-completions endpoint, with the tool list the local agent built.
//
// Two providers:
//   three-ws  <origin>/api/v1, the metered endpoint billed to the account's
//             credits. The request carries `tools`, so the endpoint answers as
//             a plain tool-calling model and the tools run HERE, on this
//             machine. The key needs the `inference` scope.
//   openai    any base URL that speaks the same wire format (a local
//             llama.cpp / Ollama / vLLM server, or a hosted lane) with its own key.

import { ApiError, errorOf, request, USER_AGENT } from './http.js';
import { THREE_WS_MODEL } from './config.js';

const ROUND_TIMEOUT_MS = 180_000;

/** Resolve the endpoint, key and model id the config names. Throws a readable error when something is missing. */
export function resolveModelTarget(config, credential, vars = process.env) {
	const m = config.model || {};
	if (m.provider === 'openai') {
		if (!m.baseUrl) throw new ApiError('model.baseUrl is not set. Run `/model openai <base-url> <model>` or set THREE_WS_AGENT_BASE_URL.', { code: 'model_unconfigured' });
		const key = m.apiKey || (m.apiKeyEnv ? vars[m.apiKeyEnv] : null) || vars.THREE_WS_AGENT_API_KEY || vars.OPENAI_API_KEY || null;
		if (!m.model) throw new ApiError('model.model is not set. Run `/model openai <base-url> <model>` or set THREE_WS_AGENT_MODEL.', { code: 'model_unconfigured' });
		return { provider: 'openai', baseUrl: m.baseUrl.replace(/\/+$/, ''), key, model: m.model, headers: {}, label: `${m.model} @ ${new URL(m.baseUrl).host}` };
	}
	if (!credential?.token) {
		throw new ApiError('Not signed in to three.ws. Run `three-ws-agent login` (or set THREE_WS_API_KEY), or point the agent at your own model with `/model openai <base-url> <model>`.', { code: 'not_signed_in' });
	}
	const headers = config.agentId ? { 'x-three-agent': config.agentId } : {};
	return { provider: 'three-ws', baseUrl: `${config.origin}/api/v1`, key: credential.token, model: m.model || THREE_WS_MODEL, headers, label: `${m.model || THREE_WS_MODEL} (three.ws credits)` };
}

/** Parse an OpenAI SSE body. Calls onContent per text delta; resolves the accumulated round. */
export async function readSse(body, { onContent, signal } = {}) {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buf = '';
	let content = '';
	let usage = null;
	let billing = null;
	let finishReason = null;
	const toolCalls = [];
	const onAbort = () => reader.cancel().catch(() => {});
	signal?.addEventListener('abort', onAbort, { once: true });
	try {
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
				if (payload === '[DONE]') continue;
				let evt;
				try {
					evt = JSON.parse(payload);
				} catch {
					continue;
				}
				if (evt.error) throw new ApiError(`model stream error: ${evt.error.message || JSON.stringify(evt.error)}`, { code: 'stream_error' });
				if (evt.usage) usage = evt.usage;
				if (evt.billing) billing = evt.billing;
				const choice = evt.choices?.[0];
				if (!choice) continue;
				if (choice.finish_reason) finishReason = choice.finish_reason;
				const delta = choice.delta || {};
				if (typeof delta.content === 'string' && delta.content) {
					content += delta.content;
					onContent?.(delta.content);
				}
				for (const tc of delta.tool_calls || []) {
					const idx = tc.index ?? toolCalls.length;
					if (!toolCalls[idx]) toolCalls[idx] = { id: tc.id || `call_${idx}`, type: 'function', function: { name: '', arguments: '' } };
					if (tc.id) toolCalls[idx].id = tc.id;
					if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
					if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
				}
			}
		}
	} finally {
		signal?.removeEventListener('abort', onAbort);
	}
	if (signal?.aborted) throw new ApiError('interrupted', { code: 'aborted' });
	return { content, toolCalls: toolCalls.filter(Boolean), usage, billing, finishReason };
}

function friendlyModelError(status, code, message, target) {
	if (status === 402 || code === 'insufficient_credits') {
		return `${message} Top up at ${target.baseUrl.replace(/\/api\/v1$/, '')}/credits, or switch to your own model with /model openai <base-url> <model>.`;
	}
	if (code === 'insufficient_scope') return `${message} Run \`three-ws-agent login\` to mint a key with the inference scope.`;
	if (status === 401) return `${message} Run \`three-ws-agent login\` again.`;
	return message;
}

/**
 * Build the model client for a config + credential.
 * `round` resolves `{ content, toolCalls, usage, billing }`.
 */
export function createModel(config, credential, { fetchImpl, vars } = {}) {
	const target = resolveModelTarget(config, credential, vars);
	let sendUsageOption = true;

	async function round({ messages, tools, signal, onContent }) {
		const body = {
			model: target.model,
			messages,
			stream: true,
			max_tokens: config.model?.maxTokens || 4096,
			temperature: config.model?.temperature ?? 0.3,
		};
		if (sendUsageOption) body.stream_options = { include_usage: true };
		if (tools?.length) {
			body.tools = tools;
			body.tool_choice = 'auto';
		}
		const headers = { accept: 'text/event-stream', ...target.headers };
		if (target.key) headers.authorization = `Bearer ${target.key}`;
		const doRequest = fetchImpl
			? () => fetchImpl(`${target.baseUrl}/chat/completions`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json', 'user-agent': USER_AGENT }, body: JSON.stringify(body), signal })
			: () => request(`${target.baseUrl}/chat/completions`, { method: 'POST', headers, json: body, timeoutMs: ROUND_TIMEOUT_MS, signal });
		const res = await doRequest();
		if (!res.ok) {
			const text = await res.text().catch(() => '');
			let data = null;
			try {
				data = JSON.parse(text);
			} catch {
				data = null;
			}
			const { code, message } = errorOf(data, text, res);
			// Some OpenAI-compatible hosts reject the usage option; drop it once and retry.
			if (res.status === 400 && sendUsageOption && /stream_options/i.test(message)) {
				sendUsageOption = false;
				return round({ messages, tools, signal, onContent });
			}
			throw new ApiError(friendlyModelError(res.status, code, message, target), { status: res.status, code, body: data });
		}
		if (!res.body) throw new ApiError('the model returned an empty response', { code: 'empty_response' });
		return readSse(res.body, { onContent, signal });
	}

	async function listModels() {
		const headers = { ...target.headers };
		if (target.key) headers.authorization = `Bearer ${target.key}`;
		const res = await request(`${target.baseUrl}/models`, { headers, timeoutMs: 15_000 });
		const data = await res.json().catch(() => null);
		if (!res.ok) throw new ApiError(`${res.status}: ${errorOf(data, '', res).message}`, { status: res.status });
		return (data?.data || []).map((m) => ({ id: m.id, owner: m.owned_by || null, description: m.description || null }));
	}

	return { target, label: target.label, round, listModels };
}
