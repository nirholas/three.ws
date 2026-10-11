// Anatomy writer: streams a machine spec out of Claude.
//
// A good spec is 6 to 14K tokens of exact JSON (geometry, motion, physics and
// a tour) and the visitor watches it assemble part by part, so every rung
// streams and forwards text deltas as they arrive. Order is quality first,
// the same chain the editorial writer uses (api/_lib/x-content/llm.js):
//
//   1. Claude on Vertex AI (Google credits), when the project is entitled
//   2. Claude on the Anthropic API, when a key is configured
//   3. Claude through OpenRouter
//   4. Kimi K3, then Nemotron Ultra and Super, on NVIDIA NIM (free)
//   5. the platform's general chain, non-streaming, so a request is never
//      refused while any model answers
//
// A rung that fails before any text arrived is skipped silently. One that
// fails part way through emits `reset` so the client clears the half-drawn
// machine before the next rung starts over.

import { llmComplete } from '../llm.js';
import { recordEvent } from '../usage.js';

export const ANATOMY_MODEL_DEFAULT = 'claude-opus-5';
const FALLBACK_CLAUDE = 'claude-sonnet-5';
const MAX_TOKENS = 16_000;
// A healthy host starts streaming within seconds even on the long system
// prompt. One that has not by now is queued or stalled, and waiting longer
// would spend the whole request on it, so the ladder moves on.
const FIRST_TOKEN_MS = 45_000;
// Degenerate sampling (one token repeated forever) is a real failure mode of
// some hosted models under load. It never becomes JSON, so it is cut off early.
const DEGENERATE_WINDOW = 240;

/** True when the tail of the text is one or two characters repeated. */
export function isDegenerate(text) {
	if (text.length < DEGENERATE_WINDOW + 60) return false;
	const tail = text.slice(-DEGENERATE_WINDOW).replace(/\s+/g, '');
	return tail.length > 0 && new Set(tail).size <= 2;
}

export class AnatomyWriterError extends Error {
	constructor(message, failures = []) {
		super(message);
		this.code = 'writer_unavailable';
		this.failures = failures;
	}
}

/** Parse an SSE body into { event, data } records. */
export async function* sseRecords(body) {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buf = '';
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			buf += decoder.decode(value, { stream: true });
			let idx;
			while ((idx = buf.search(/\r?\n\r?\n/)) !== -1) {
				const raw = buf.slice(0, idx);
				buf = buf.slice(idx).replace(/^\r?\n\r?\n/, '');
				let event = 'message';
				const data = [];
				for (const line of raw.split(/\r?\n/)) {
					if (line.startsWith('event:')) event = line.slice(6).trim();
					else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
				}
				if (data.length) yield { event, data: data.join('\n') };
			}
		}
	} finally {
		reader.releaseLock();
	}
}

/** Read an Anthropic Messages SSE stream. Returns { text, usage, stopReason }. */
export async function readAnthropicStream(body, onDelta) {
	let text = '';
	const usage = { input: 0, output: 0 };
	let stopReason = null;
	for await (const { data } of sseRecords(body)) {
		let msg;
		try {
			msg = JSON.parse(data);
		} catch {
			continue;
		}
		if (msg.type === 'message_start') usage.input = msg.message?.usage?.input_tokens || 0;
		else if (msg.type === 'content_block_delta' && msg.delta?.type === 'text_delta') {
			text += msg.delta.text;
			onDelta(msg.delta.text);
		} else if (msg.type === 'message_delta') {
			usage.output = msg.usage?.output_tokens || usage.output;
			stopReason = msg.delta?.stop_reason || stopReason;
		} else if (msg.type === 'error') {
			throw new Error(`stream error: ${msg.error?.message || 'unknown'}`);
		}
	}
	return { text, usage, stopReason };
}

/** Read an OpenAI-style chat-completions SSE stream. */
export async function readChatStream(body, onDelta) {
	let text = '';
	const usage = { input: 0, output: 0 };
	let stopReason = null;
	for await (const { data } of sseRecords(body)) {
		if (data === '[DONE]') break;
		let msg;
		try {
			msg = JSON.parse(data);
		} catch {
			continue;
		}
		if (msg.error) throw new Error(`stream error: ${msg.error.message || 'unknown'}`);
		const choice = msg.choices?.[0];
		const piece = choice?.delta?.content;
		if (typeof piece === 'string' && piece) {
			text += piece;
			onDelta(piece);
		}
		if (choice?.finish_reason) stopReason = choice.finish_reason;
		if (msg.usage) usage.input = msg.usage.prompt_tokens || usage.input;
		if (msg.usage) usage.output = msg.usage.completion_tokens || usage.output;
	}
	return { text, usage, stopReason };
}

function anthropicBody(model, system, messages) {
	return { model, max_tokens: MAX_TOKENS, temperature: 0.4, stream: true, system, messages };
}

export function writerRungs(env = process.env) {
	const rungs = [];
	const primary = env.ANATOMY_MODEL || ANATOMY_MODEL_DEFAULT;
	// Vertex Claude needs Model Garden entitlement as well as a project; the
	// shared VERTEX_CLAUDE_ENABLED flag (docs/ops/llm-lanes.md) says whether the
	// project has it, so an unentitled deployment never spends a round trip here.
	if (env.GOOGLE_CLOUD_PROJECT && (env.VERTEX_CLAUDE_ENABLED === '1' || env.VERTEX_CLAUDE_ENABLED === 'true')) {
		for (const model of [...new Set([primary, FALLBACK_CLAUDE])]) {
			rungs.push({
				provider: 'vertex',
				model,
				kind: 'anthropic',
				open: async ({ system, messages, signal }) => {
					const { vertexAnthropicMessages } = await import('../vertex-claude.js');
					return vertexAnthropicMessages(anthropicBody(model, system, messages), { stream: true, signal });
				},
			});
		}
	}
	if (env.ANTHROPIC_API_KEY) {
		rungs.push({
			provider: 'anthropic',
			model: primary,
			kind: 'anthropic',
			open: ({ system, messages, signal, fetchImpl }) =>
				fetchImpl('https://api.anthropic.com/v1/messages', {
					method: 'POST',
					headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
					body: JSON.stringify(anthropicBody(primary, system, messages)),
					signal,
				}),
		});
	}
	const chat = (provider, url, key, model, extra = {}) => ({
		provider,
		model,
		kind: 'chat',
		open: ({ system, messages, signal, fetchImpl }) =>
			fetchImpl(url, {
				method: 'POST',
				headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...extra.headers },
				body: JSON.stringify({
					model,
					max_tokens: MAX_TOKENS,
					temperature: 0.4,
					stream: true,
					messages: [{ role: 'system', content: system }, ...messages],
					...extra.body,
				}),
				signal,
			}),
	});
	if (env.OPENROUTER_API_KEY) {
		for (const model of [...new Set([primary, FALLBACK_CLAUDE])]) {
			rungs.push(
				chat('openrouter', 'https://openrouter.ai/api/v1/chat/completions', env.OPENROUTER_API_KEY, `anthropic/${model}`, {
					headers: { 'http-referer': 'https://three.ws', 'x-title': 'three.ws Anatomy' },
				}),
			);
		}
	}
	if (env.NVIDIA_API_KEY) {
		// Three separate NIM functions on one key: Kimi writes the best specs,
		// the Nemotron pair answers when Kimi's host is queued or stalled.
		for (const model of ['moonshotai/kimi-k3', 'nvidia/nemotron-3-ultra-550b-a55b', 'nvidia/nemotron-3-super-120b-a12b']) {
			rungs.push(
				chat('nvidia', 'https://integrate.api.nvidia.com/v1/chat/completions', env.NVIDIA_API_KEY, model, {
					body: { chat_template_kwargs: { thinking: false, enable_thinking: false } },
				}),
			);
		}
	}
	return rungs;
}

/**
 * Stream one completion through the ladder.
 *   messages   Anthropic-shaped [{ role, content: string }]
 *   onDelta    (text) => void for every streamed piece
 *   onReset    () => void when a rung died after streaming some text
 * Returns { text, provider, model, stopReason }.
 */
export async function streamSpec({ system, messages, onDelta = () => {}, onReset = () => {}, deadline = Date.now() + 420_000, track = {}, env = process.env, fetchImpl = fetch }) {
	const failures = [];
	for (const rung of writerRungs(env)) {
		const remaining = deadline - Date.now();
		if (remaining < 20_000) break;
		const started = Date.now();
		let streamed = false;
		let soFar = '';
		let why = null;
		const ctrl = new AbortController();
		const abort = (reason) => {
			why ??= reason;
			ctrl.abort();
		};
		const timer = setTimeout(() => abort('timed out'), remaining);
		const firstToken = setTimeout(() => abort(`no output in ${FIRST_TOKEN_MS / 1000}s`), Math.min(FIRST_TOKEN_MS, remaining));
		try {
			const res = await rung.open({ system, messages, signal: ctrl.signal, fetchImpl });
			if (!res.ok || !res.body) {
				const detail = await res.text().catch(() => '');
				throw new Error(`${res.status} ${detail.slice(0, 160)}`);
			}
			const reader = rung.kind === 'anthropic' ? readAnthropicStream : readChatStream;
			const out = await reader(res.body, (piece) => {
				if (!streamed) clearTimeout(firstToken);
				streamed = true;
				soFar += piece;
				if (isDegenerate(soFar)) {
					abort('degenerate output');
					throw new Error('degenerate output');
				}
				onDelta(piece);
			});
			if (!out.text.trim()) throw new Error('empty completion');
			recordEvent({
				kind: 'llm',
				provider: rung.provider,
				model: rung.model,
				inputTokens: out.usage.input,
				outputTokens: out.usage.output,
				latencyMs: Date.now() - started,
				userId: track.userId ?? null,
				tool: 'anatomy',
			});
			return { text: out.text, provider: rung.provider, model: rung.model, stopReason: out.stopReason };
		} catch (err) {
			failures.push(`${rung.provider}:${rung.model}: ${why || (err?.name === 'AbortError' ? 'timed out' : err?.message)}`);
			if (streamed) onReset();
		} finally {
			clearTimeout(timer);
			clearTimeout(firstToken);
		}
	}
	if (failures.length) console.warn('[anatomy-writer] streaming ladder exhausted:', failures.join(' | '));
	const remaining = deadline - Date.now();
	if (remaining < 15_000) throw new AnatomyWriterError('No model finished the machine in time. Try again.', failures);
	try {
		const user = messages.map((m) => `${m.role === 'assistant' ? 'Your previous answer' : 'Request'}:\n${m.content}`).join('\n\n');
		const completion = await llmComplete({ system, user, maxTokens: MAX_TOKENS, timeoutMs: remaining, track: { tool: 'anatomy', ...track } });
		const text = completion?.text || '';
		if (!text.trim()) throw new Error('empty completion');
		onDelta(text);
		return { text, provider: completion.provider || null, model: completion.model || null, stopReason: null };
	} catch (err) {
		failures.push(`general: ${err?.message}`);
		throw new AnatomyWriterError('Every model is unavailable right now. Try again in a minute.', failures);
	}
}
