// POST /api/agent/run - the general server-side agent loop.
//
// Speaks the OpenAI chat-completions wire format both ways: the request body
// is `{ messages, stream }` exactly as a chat client would send to any
// OpenAI-compatible provider, and the response is either a standard
// chat.completion JSON or an SSE stream of chat.completion.chunk deltas. That
// makes the loop a drop-in "model" for the chat client's Built-in lane
// (model id `three-ws/agent`), with zero client-side protocol work.
//
// Inside one request, the shared loop in api/_lib/agent-loop.js drives it:
// call the LLM over the shared tool-calling chain (api/_lib/llm-tool-chain.js,
// free lanes first, Vertex credits anchor last), execute any requested tools
// server-side from the READ-ONLY registry (api/_lib/agent-tools.js: web
// search, token prices, trending, SOL balances, the trade-firewall safety
// verdict, smart money, SNS), feed results back, repeat, then stream the
// final answer. Every planned tool call is preflighted through the GuardChain
// in headless mode first; a blacklisted call is returned to the model as a
// blocked-tool error, never executed. No tool here can sign, send, or mutate;
// fund-moving tools live client-side behind the wallet modal and
// /api/agent/guard.
//
// Tool activity is surfaced as SSE comment lines (`: tool web_search …`),
// which every OpenAI SSE parser ignores by spec, so observability rides along
// without breaking any client.

import { cors, error, json, method, rateLimited, readJson, wrap } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { providerChain } from '../_lib/llm-tool-chain.js';
import { agentToolSchemas, agentToolHandlers } from '../_lib/agent-tools.js';
import {
	AGENT_SYSTEM_NOTE,
	createAgentLoop,
	finalAnswer,
	initialLoopState,
	loopFinished,
} from '../_lib/agent-loop.js';

export const AGENT_MODEL_ID = 'three-ws/agent';

const MAX_TOOL_ROUNDS = 4;
const MAX_MESSAGES = 40;
const MAX_BODY_BYTES = 512_000;

function sanitizeMessages(raw) {
	if (!Array.isArray(raw)) return null;
	const out = [];
	for (const m of raw.slice(-MAX_MESSAGES)) {
		if (!m || typeof m !== 'object') continue;
		const role = ['system', 'user', 'assistant'].includes(m.role) ? m.role : null;
		if (!role) continue;
		const content =
			typeof m.content === 'string'
				? m.content
				: Array.isArray(m.content)
					? m.content
							.map((p) => (typeof p?.text === 'string' ? p.text : ''))
							.join('\n')
							.trim()
					: '';
		out.push({ role, content });
	}
	return out.length ? out : null;
}

/** OpenAI chat.completion.chunk SSE frame. */
function chunkFrame(id, delta, finishReason = null) {
	return `data: ${JSON.stringify({
		id,
		object: 'chat.completion.chunk',
		created: Math.floor(Date.now() / 1000),
		model: AGENT_MODEL_ID,
		choices: [{ index: 0, delta, finish_reason: finishReason }],
	})}\n\n`;
}

/**
 * Run one full agent completion over `body.messages` and answer in OpenAI
 * format (SSE when body.stream, JSON otherwise). Shared by POST /api/agent/run
 * and the chat proxy's `three-ws/agent` model branch; `opts.rateLimited` skips
 * the limiter when the caller already applied its own.
 */
export async function runAgentCompletion(req, res, body, opts = {}) {
	if (!opts.rateLimited) {
		const rl = await limits.agentRunIp(clientIp(req));
		if (!rl.success) return rateLimited(res, rl);
	}

	const chain = providerChain();
	if (!chain.length) {
		return error(res, 503, 'llm_unavailable', 'No LLM provider is configured for the agent loop.');
	}

	const messages = sanitizeMessages(body?.messages);
	if (!messages) return error(res, 400, 'bad_messages', 'Provide `messages: [{ role, content }]`.');

	// The server note rides as a second system message so a client-authored
	// persona keeps the first slot.
	const sysIdx = messages[0]?.role === 'system' ? 1 : 0;
	messages.splice(sysIdx, 0, { role: 'system', content: AGENT_SYSTEM_NOTE });

	const stream = body?.stream !== false;
	const completionId = `agentrun-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

	let sseOpen = false;
	const sse = (text) => {
		if (!sseOpen) {
			res.statusCode = 200;
			res.setHeader('content-type', 'text/event-stream; charset=utf-8');
			res.setHeader('cache-control', 'no-store');
			res.setHeader('x-accel-buffering', 'no');
			res.write(chunkFrame(completionId, { role: 'assistant' }));
			sseOpen = true;
		}
		res.write(text);
	};

	let streamedAny = false;
	const loop = createAgentLoop({
		chain,
		toolSchemas: agentToolSchemas(),
		toolHandlers: agentToolHandlers(),
		maxToolRounds: MAX_TOOL_ROUNDS,
		onContent: (delta) => {
			streamedAny = true;
			if (stream) sse(chunkFrame(completionId, { content: delta }));
		},
		onEvent: (event) => {
			if (stream && event.kind === 'tool_call') sse(`: tool ${event.tool}\n\n`);
		},
	});

	let { state, context } = initialLoopState({
		operationId: completionId,
		messages,
		maxSteps: MAX_TOOL_ROUNDS * 2 + 3,
	});

	try {
		while (!loopFinished(state, context)) {
			({ state, context } = await loop.step(state, context));
		}
	} catch (err) {
		if (sseOpen) {
			sse(`: error ${String(err?.message || err).slice(0, 200)}\n\n`);
			sse(chunkFrame(completionId, {}, 'stop'));
			sse('data: [DONE]\n\n');
			return res.end();
		}
		return error(res, 502, 'agent_loop_failed', String(err?.message || err).slice(0, 300));
	}
	const finalContent = finalAnswer(state);

	if (state.status === 'error') {
		const detail = String(state.error?.message || state.error || 'agent loop error').slice(0, 300);
		if (sseOpen) {
			sse(`: error ${detail}\n\n`);
			sse(chunkFrame(completionId, {}, 'stop'));
			sse('data: [DONE]\n\n');
			return res.end();
		}
		return error(res, 502, 'agent_loop_failed', detail);
	}

	if (stream) {
		// A run whose final round emitted no deltas (e.g. everything came from a
		// non-streaming provider quirk) still owes the client the content.
		if (!streamedAny && finalContent) sse(chunkFrame(completionId, { content: finalContent }));
		sse(chunkFrame(completionId, {}, 'stop'));
		sse('data: [DONE]\n\n');
		return res.end();
	}

	return json(res, 200, {
		id: completionId,
		object: 'chat.completion',
		created: Math.floor(Date.now() / 1000),
		model: AGENT_MODEL_ID,
		choices: [
			{ index: 0, message: { role: 'assistant', content: finalContent }, finish_reason: 'stop' },
		],
	});
}

export default wrap(async function handler(req, res) {
	if (cors(req, res, { methods: 'POST, OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	let body;
	try {
		body = await readJson(req, MAX_BODY_BYTES);
	} catch (err) {
		return error(res, err?.status || 400, 'bad_json', err?.message || 'Body must be JSON.');
	}

	return runAgentCompletion(req, res, body);
});
