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
import { sql } from '../_lib/db.js';
import { isUuid } from '../_lib/validate.js';
import { authenticateBearer, extractBearer, getSessionUser, hasScope } from '../_lib/auth.js';
import { learningContext, afterRunCompleted } from '../_lib/agent-learning/runtime.js';
import { countUserTurns } from '../_lib/agent-learning/nudge.js';
import { agentSkillsForPrompt } from '../_lib/agent-custom-skills.js';
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

// Scopes a bearer may carry to bind the loop to one of its account's agents.
const LEARNING_SCOPES = ['memory:write', 'agents:write', 'inference'];

/**
 * The (agent, account) the completion speaks for, when the request names an
 * agent (`agent_id` in the body or an `x-three-agent` header). A named agent
 * must belong to the caller. Returns null for an anonymous, agent-less call,
 * which runs exactly as before: no memory, no learning.
 *
 * @returns {Promise<{ agentId: string, userId: string } | { error: [number, string, string] } | null>}
 */
export async function resolveLearningBinding(req, body) {
	const named = body?.agent_id || req.headers?.['x-three-agent'] || null;
	if (!named) return null;
	if (!isUuid(String(named))) return { error: [400, 'bad_agent_id', 'agent_id must be the id of one of your agents.'] };
	let userId = null;
	const token = extractBearer(req);
	if (token) {
		const bearer = await authenticateBearer(token);
		if (bearer && LEARNING_SCOPES.some((s) => hasScope(bearer.scope, s))) userId = bearer.userId;
	} else {
		const session = await getSessionUser(req);
		if (session) userId = session.id;
	}
	if (!userId) return { error: [401, 'sign_in_required', 'Naming an agent needs its owner: sign in, or send an API key with memory:write, agents:write or inference.'] };
	const [row] = await sql`SELECT user_id FROM agent_identities WHERE id = ${String(named)} AND deleted_at IS NULL`;
	if (!row || String(row.user_id) !== String(userId)) {
		return { error: [404, 'agent_not_found', 'No agent with that id belongs to this account.'] };
	}
	return { agentId: String(named), userId: String(userId) };
}

function lastUserText(messages) {
	for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'user') return String(messages[i].content || '');
	return '';
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
 * format (SSE when body.stream, JSON otherwise). Shared by POST /api/agent/run,
 * the chat proxy's `three-ws/agent` model branch and the metered
 * /api/v1/chat/completions; `opts.rateLimited` skips the limiter when the
 * caller already applied its own.
 *
 * Token usage is summed over every model round and reported the OpenAI way: a
 * `usage` object on the JSON response, and a final usage chunk on a stream when
 * the request asked for `stream_options.include_usage`. `opts.onUsage(usage,
 * completionId)` receives the same totals once the answer is complete, which is
 * where a metered caller books the charge.
 *
 * When the request names one of the caller's agents (`agent_id`, or
 * `opts.learning` from a caller that already resolved it), the loop speaks as
 * that agent for its owner: the memory section and the agent's prompt-only
 * skills join the system prompt, the memory tools join the registry, the
 * memory nudge rides every N turns (api/_lib/agent-learning/runtime.js), and a
 * run with enough real tool work drafts a skill for the owner to review.
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

	const completionId = `agentrun-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

	let binding = opts.learning || null;
	if (!binding) {
		const resolved = await resolveLearningBinding(req, body);
		if (resolved?.error) return error(res, ...resolved.error);
		binding = resolved;
	}
	const goal = lastUserText(messages);
	const learning = binding
		? await learningContext({
				agentId: binding.agentId,
				userId: binding.userId,
				query: goal,
				source: 'chat',
				runRef: completionId,
				userTurns: countUserTurns(messages),
			})
		: null;
	const skillsBlock = binding ? (await agentSkillsForPrompt(binding.agentId).catch(() => ({ block: '' }))).block : '';
	const learningNote = [learning?.block, skillsBlock, learning?.nudge].filter(Boolean).join('\n\n');
	if (learningNote) messages.splice(sysIdx + 1, 0, { role: 'system', content: learningNote });

	const stream = body?.stream !== false;

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
	const toolTrace = [];
	// Platform cost rides along (null when any round hit an unpriced lane) so a
	// metered caller can record honest spend next to what it billed.
	const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, estimated: false, cost_micro_usd: 0, lanes: [] };
	const loop = createAgentLoop({
		chain,
		toolSchemas: [...agentToolSchemas(), ...(learning?.schemas || [])],
		toolHandlers: { ...agentToolHandlers(), ...(learning?.handlers || {}) },
		maxToolRounds: MAX_TOOL_ROUNDS,
		onContent: (delta) => {
			streamedAny = true;
			if (stream) sse(chunkFrame(completionId, { content: delta }));
		},
		onEvent: (event) => {
			if (event.kind === 'model_call' && event.usage) {
				usage.prompt_tokens += event.usage.input || 0;
				usage.completion_tokens += event.usage.output || 0;
				usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
				if (event.usage.estimated) usage.estimated = true;
				usage.cost_micro_usd =
					usage.cost_micro_usd == null || event.costMicroUsd == null ? null : usage.cost_micro_usd + event.costMicroUsd;
				usage.lanes.push({ provider: event.provider, model: event.model });
			}
			if (event.kind === 'tool_result') {
				toolTrace.push({ kind: 'tool_result', tool: event.tool, input: event.args, output: event.error ? { error: event.error } : event.result });
			}
			if (event.kind === 'tool_call' || event.kind === 'tool_blocked') toolTrace.push({ kind: event.kind, tool: event.tool, input: event.args });
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

	const openAiUsage = {
		prompt_tokens: usage.prompt_tokens,
		completion_tokens: usage.completion_tokens,
		total_tokens: usage.total_tokens,
	};
	const billed = opts.onUsage ? await opts.onUsage(usage, completionId) : null;
	// Drafting happens before the connection closes (a closed request loses its
	// CPU on Cloud Run) and only costs time when the run qualifies.
	const learnFromRun = () =>
		binding && learning?.enabled
			? afterRunCompleted({ agentId: binding.agentId, userId: binding.userId, runRef: completionId, goal, steps: toolTrace, finalAnswer: finalContent })
			: null;

	if (stream) {
		// A run whose final round emitted no deltas (e.g. everything came from a
		// non-streaming provider quirk) still owes the client the content.
		if (!streamedAny && finalContent) sse(chunkFrame(completionId, { content: finalContent }));
		sse(chunkFrame(completionId, {}, 'stop'));
		if (body?.stream_options?.include_usage) {
			sse(`data: ${JSON.stringify({
				id: completionId,
				object: 'chat.completion.chunk',
				created: Math.floor(Date.now() / 1000),
				model: AGENT_MODEL_ID,
				choices: [],
				usage: openAiUsage,
				...(billed ? { billing: billed } : {}),
			})}\n\n`);
		}
		sse('data: [DONE]\n\n');
		await learnFromRun();
		return res.end();
	}

	await learnFromRun();
	return json(res, 200, {
		id: completionId,
		object: 'chat.completion',
		created: Math.floor(Date.now() / 1000),
		model: AGENT_MODEL_ID,
		choices: [
			{ index: 0, message: { role: 'assistant', content: finalContent }, finish_reason: 'stop' },
		],
		usage: openAiUsage,
		...(billed ? { billing: billed } : {}),
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
