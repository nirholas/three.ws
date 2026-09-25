// The client-tool lane of the metered endpoint (POST /api/v1/chat/completions
// with a `tools` array).
//
// Without `tools`, the endpoint runs the platform's own server-side agent loop
// and answers with text. A self-hosted agent (the `@three-ws/agent` runtime,
// any OpenAI SDK agent framework) instead brings its OWN tools: files, a shell,
// its MCP servers. For that caller the endpoint must behave as a plain
// tool-calling model: one round over the platform's provider chain, the
// model's `tool_calls` returned verbatim for the caller to execute on its own
// machine, and the transcript (assistant tool calls, tool results) accepted
// back on the next request. Nothing here executes a tool.
//
// Same chain and failover as every server loop (api/_lib/llm-tool-chain.js):
// free lanes first, the credits-funded Vertex anchor last, failing over only
// before a byte has streamed so the caller never sees a sentence twice.

import { providerChain, streamRound } from './llm-tool-chain.js';
import { costMicroUsd } from './llm-pricing.js';

export const MAX_CLIENT_TOOLS = 128;
export const MAX_CLIENT_MESSAGES = 200;
const MAX_TOOL_NAME = 64;
const DEFAULT_MAX_TOKENS = 4096;
const MAX_TOKENS_CAP = 8192;
const TOOL_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export class ClientToolError extends Error {
	constructor(code, message) {
		super(message);
		this.code = code;
		this.status = 400;
	}
}

/** True when the request body asks for the client-tool lane. */
export function wantsClientTools(body) {
	return Array.isArray(body?.tools) && body.tools.length > 0;
}

/**
 * Validate the caller's OpenAI function tools. Throws ClientToolError on a
 * malformed list so the caller gets a 400 that names the bad entry.
 */
export function normalizeClientTools(tools) {
	if (!Array.isArray(tools)) throw new ClientToolError('bad_tools', '`tools` must be an array of function tools.');
	if (tools.length > MAX_CLIENT_TOOLS) throw new ClientToolError('too_many_tools', `Send at most ${MAX_CLIENT_TOOLS} tools per request.`);
	const seen = new Set();
	return tools.map((t, i) => {
		const fn = t?.function;
		if (t?.type !== 'function' || !fn || typeof fn !== 'object') {
			throw new ClientToolError('bad_tools', `tools[${i}] must be { type: "function", function: { name, description, parameters } }.`);
		}
		const name = String(fn.name || '');
		if (!TOOL_NAME_RE.test(name) || name.length > MAX_TOOL_NAME) {
			throw new ClientToolError('bad_tools', `tools[${i}].function.name must be 1-64 letters, digits, underscores or dashes.`);
		}
		if (seen.has(name)) throw new ClientToolError('bad_tools', `tools[${i}]: the tool name "${name}" is used twice.`);
		seen.add(name);
		const parameters = fn.parameters && typeof fn.parameters === 'object' && !Array.isArray(fn.parameters) ? fn.parameters : { type: 'object', properties: {} };
		return {
			type: 'function',
			function: { name, description: String(fn.description || '').slice(0, 1024), parameters },
		};
	});
}

/**
 * The endpoint's entry check: null when the request brought no tools (the
 * server-side agent loop answers), the validated list otherwise. Throws
 * ClientToolError (status 400) on a malformed list, before anything is billed.
 */
export function sanitizeClientTools(tools) {
	if (tools == null || (Array.isArray(tools) && !tools.length)) return null;
	return normalizeClientTools(tools);
}

function textOf(content) {
	if (typeof content === 'string') return content;
	if (Array.isArray(content)) return content.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('\n');
	return content == null ? null : JSON.stringify(content);
}

/**
 * Keep the transcript a tool-calling model needs: system, user, assistant
 * (with its tool_calls) and tool results (with their tool_call_id).
 */
export function sanitizeClientMessages(raw) {
	if (!Array.isArray(raw) || !raw.length) {
		throw new ClientToolError('bad_messages', 'Provide `messages: [{ role, content }]`.');
	}
	const out = [];
	for (const m of raw.slice(-MAX_CLIENT_MESSAGES)) {
		if (!m || typeof m !== 'object') continue;
		if (m.role === 'system' || m.role === 'user') {
			out.push({ role: m.role, content: textOf(m.content) ?? '' });
		} else if (m.role === 'assistant') {
			const msg = { role: 'assistant', content: textOf(m.content) };
			if (Array.isArray(m.tool_calls) && m.tool_calls.length) {
				msg.tool_calls = m.tool_calls
					.filter((tc) => tc?.function?.name)
					.map((tc) => ({
						id: String(tc.id || ''),
						type: 'function',
						function: { name: String(tc.function.name), arguments: typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments ?? {}) },
					}));
				if (!msg.tool_calls.length) delete msg.tool_calls;
			}
			if (msg.content == null && !msg.tool_calls) msg.content = '';
			out.push(msg);
		} else if (m.role === 'tool') {
			if (!m.tool_call_id) continue;
			out.push({ role: 'tool', tool_call_id: String(m.tool_call_id), content: textOf(m.content) ?? '' });
		}
	}
	// A tool result whose call fell off the front of the window would be
	// rejected by every provider; drop leading orphans.
	while (out.length && out[0].role === 'tool') out.shift();
	if (!out.some((m) => m.role === 'user')) throw new ClientToolError('bad_messages', 'The transcript needs at least one user message.');
	return out;
}

function estimateTokens(value) {
	const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
	return Math.ceil(text.length / 4);
}

function frame(id, model, delta, finishReason = null) {
	return `data: ${JSON.stringify({
		id,
		object: 'chat.completion.chunk',
		created: Math.floor(Date.now() / 1000),
		model,
		choices: [{ index: 0, delta, finish_reason: finishReason }],
	})}\n\n`;
}

/**
 * One model round over the provider chain with the caller's tools.
 * @returns {Promise<{ content: string, toolCalls: Array<{id,name,args}>, usage: object, provider: string, model: string }>}
 */
export async function clientToolRound({ messages, tools, maxTokens, temperature, onContent, chain = providerChain() }) {
	if (!chain.length) throw Object.assign(new Error('No LLM provider is configured.'), { status: 503, code: 'llm_unavailable' });
	let lastErr = null;
	for (const provider of chain) {
		let emitted = false;
		try {
			const out = await streamRound(provider, {
				messages,
				tools,
				temperature,
				maxTokens,
				onContent: (d) => {
					emitted = true;
					onContent?.(d);
				},
			});
			const model = provider.catalogModel || provider.model;
			const input = out.usage ? out.usage.input : estimateTokens(messages) + estimateTokens(tools);
			const output = out.usage ? out.usage.output : estimateTokens(out.content) + estimateTokens(out.toolCalls);
			return {
				content: out.content,
				toolCalls: out.toolCalls,
				provider: provider.name,
				model,
				usage: {
					prompt_tokens: input,
					completion_tokens: output,
					total_tokens: input + output,
					estimated: !out.usage,
					cost_micro_usd: costMicroUsd({ provider: provider.name, model, input, output, reportedCostUsd: out.usage?.reportedCostUsd ?? null }),
					lanes: [{ provider: provider.name, model }],
				},
			};
		} catch (err) {
			lastErr = err;
			if (emitted) throw err;
		}
	}
	throw lastErr || new Error('No LLM provider available');
}

/**
 * Answer one client-tool request in OpenAI format (SSE when body.stream is not
 * false). `opts.onUsage(usage, completionId)` books the charge and returns the
 * billing block that rides on the final usage chunk.
 */
export async function runClientToolCompletion(req, res, body, { modelId, onUsage, chain, tools: validated } = {}) {
	let tools;
	let messages;
	try {
		tools = validated || normalizeClientTools(body.tools);
		messages = sanitizeClientMessages(body.messages);
	} catch (err) {
		res.statusCode = err.status || 400;
		res.setHeader('content-type', 'application/json; charset=utf-8');
		return res.end(JSON.stringify({ error: { type: err.code, code: err.code, message: err.message } }));
	}
	const requested = Number(body.max_tokens ?? body.max_completion_tokens);
	const maxTokens = Number.isFinite(requested) && requested > 0 ? Math.min(Math.round(requested), MAX_TOKENS_CAP) : DEFAULT_MAX_TOKENS;
	const t = Number(body.temperature);
	const temperature = Number.isFinite(t) ? Math.min(Math.max(t, 0), 2) : 0.3;
	const stream = body.stream !== false;
	const id = `chatcmpl-tools-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

	let open = false;
	const write = (text) => {
		if (!open) {
			res.statusCode = 200;
			res.setHeader('content-type', 'text/event-stream; charset=utf-8');
			res.setHeader('cache-control', 'no-store');
			res.setHeader('x-accel-buffering', 'no');
			res.write(frame(id, modelId, { role: 'assistant' }));
			open = true;
		}
		res.write(text);
	};

	let out;
	try {
		out = await clientToolRound({
			messages,
			tools,
			maxTokens,
			temperature,
			chain,
			onContent: stream ? (d) => write(frame(id, modelId, { content: d })) : undefined,
		});
	} catch (err) {
		const message = String(err?.message || err).slice(0, 300);
		if (open) {
			write(`data: ${JSON.stringify({ error: { type: 'upstream_error', code: 'upstream_error', message } })}\n\n`);
			write('data: [DONE]\n\n');
			return res.end();
		}
		res.statusCode = err?.status === 503 ? 503 : 502;
		res.setHeader('content-type', 'application/json; charset=utf-8');
		return res.end(JSON.stringify({ error: { type: 'upstream_error', code: err?.code || 'upstream_error', message } }));
	}

	const toolCalls = out.toolCalls.map((tc, index) => ({ index, id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.args || '{}' } }));
	const finish = toolCalls.length ? 'tool_calls' : 'stop';
	const billed = onUsage ? await onUsage(out.usage, id) : null;
	const usage = { prompt_tokens: out.usage.prompt_tokens, completion_tokens: out.usage.completion_tokens, total_tokens: out.usage.total_tokens };

	if (stream) {
		if (toolCalls.length) write(frame(id, modelId, { tool_calls: toolCalls }));
		write(frame(id, modelId, {}, finish));
		if (body?.stream_options?.include_usage) {
			write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: modelId, choices: [], usage, ...(billed ? { billing: billed } : {}) })}\n\n`);
		}
		write('data: [DONE]\n\n');
		return res.end();
	}

	res.statusCode = 200;
	res.setHeader('content-type', 'application/json; charset=utf-8');
	return res.end(JSON.stringify({
		id,
		object: 'chat.completion',
		created: Math.floor(Date.now() / 1000),
		model: modelId,
		choices: [{
			index: 0,
			message: { role: 'assistant', content: out.content || null, ...(toolCalls.length ? { tool_calls: toolCalls.map(({ index, ...rest }) => rest) } : {}) },
			finish_reason: finish,
		}],
		usage,
		...(billed ? { billing: billed } : {}),
	}));
}
