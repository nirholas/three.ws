// v1 chat: one message to an agent, answered through the server-side tool loop.
//
// A message joins the agent's single thread (api/_lib/agent-thread.js), the
// same history the web copilot and every chat gateway read, so the agent
// remembers a conversation whichever surface it happened on. The reply runs
// through the shared loop (api/_lib/agent-loop.js) over the read-only tool
// registry, with the agent's persona and its installed custom skills in the
// system prompt.
//
// Billing (api/_lib/agents-v1/billing.js): the daily free allowance covers a
// message when no paid model is named, and such a message is restricted to the
// free model lanes so it can never land on a paid one. Past the allowance, or
// with a paid model named, admitCall refuses up front when credits or the
// agent's inference budget cannot cover it, and every model call is charged
// after it returns.

import { randomUUID } from 'node:crypto';
import { sql } from '../db.js';
import { apiError, intParam, numParam, strParam, page } from './http.js';
import { ModelChoiceError, modelChain, resolveMessageModel } from '../agent-model.js';
import { isFreeLane } from '../llm-pricing.js';
import { agentToolSchemas, agentToolHandlers } from '../agent-tools.js';
import { agentSkillsForPrompt } from '../agent-custom-skills.js';
import { appendThreadMessage, listThread, threadHistoryForModel } from '../agent-thread.js';
import { AGENT_SYSTEM_NOTE, createAgentLoop, finalAnswer, initialLoopState, runLoopToEnd } from '../agent-loop.js';
import { admitCall, chargeCall } from './billing.js';

export const MAX_MESSAGE_CHARS = 8000;
// Tool rounds per message before the model must answer, and the runtime step
// ceiling that bounds one reply (a model call plus its tool batch per round).
const MAX_TOOL_ROUNDS = 4;
const MAX_RUNTIME_STEPS = 24;
// Surfaces a v1 caller may label its messages with. Gateways write their own.
const API_CHANNELS = new Set(['api', 'desktop', 'cli', 'sdk']);

/**
 * Resolve the model for one message through the shared resolver
 * (api/_lib/agent-model.js): the override, else the agent's default, else the
 * platform chain. A bad choice becomes a v1 error with the same status and code.
 */
export function resolveModel(agent, override) {
	try {
		return resolveMessageModel({ requested: override, agentMeta: agent.meta || null, purpose: 'chat', signedIn: true });
	} catch (err) {
		if (err instanceof ModelChoiceError) throw apiError(err.status, err.code, err.message, { parameter: 'model' });
		throw err;
	}
}

async function systemPrompt(agent) {
	const parts = [`You are ${agent.name || 'a three.ws agent'}, an AI agent on three.ws talking with your owner.`];
	if (agent.persona_prompt) parts.push(String(agent.persona_prompt).slice(0, 8000));
	else if (agent.description) parts.push(String(agent.description).slice(0, 1000));
	const { block } = await agentSkillsForPrompt(agent.id).catch(() => ({ block: '' }));
	if (block) parts.push(block);
	parts.push(AGENT_SYSTEM_NOTE);
	parts.push('Answer conversationally and concisely. Cite tool results for any number you state.');
	return parts.join('\n\n');
}

function channelParam(v) {
	if (v == null || v === '') return 'api';
	if (typeof v !== 'string' || !API_CHANNELS.has(v)) {
		throw apiError(400, 'invalid_parameter', `channel must be one of: ${[...API_CHANNELS].join(', ')}.`, { parameter: 'channel' });
	}
	return v;
}

/** Summarize the loop's tool events into the reply's toolCalls list. */
function toolCallsFrom(events) {
	const calls = [];
	for (const e of events) {
		if (e.kind === 'tool_call') calls.push({ name: e.tool, arguments: e.args, ok: null });
		else if (e.kind === 'tool_blocked') calls.push({ name: e.tool, arguments: e.args, ok: false, blocked: true, reason: e.reason });
		else if (e.kind === 'tool_result') {
			const open = [...calls].reverse().find((c) => c.name === e.tool && c.ok === null);
			if (open) {
				open.ok = !e.error;
				if (e.error) open.error = e.error;
				open.latencyMs = e.latencyMs ?? null;
			}
		}
	}
	return calls;
}

/**
 * Send one message and wait for the reply.
 * @param {object} agent  the owned agent_identities row
 * @param {string} userId
 * @param {object} body   { message, model?, temperature?, channel? }
 */
export async function sendMessage(agent, userId, body) {
	const message = strParam(body.message, { name: 'message', max: MAX_MESSAGE_CHARS, required: true });
	const { model, tools } = resolveModel(agent, body.model ?? null);
	const temperature = numParam(body.temperature, {
		name: 'temperature',
		min: 0,
		max: 2,
		fallback: agent.meta?.runtime?.temperature ?? 0.4,
	});
	const channel = channelParam(body.channel);

	const { free } = await admitCall({ userId, agent, model });
	let { chain } = modelChain(model);
	if (free) chain = chain.filter((p) => isFreeLane(p.name, p.catalogModel || p.model));
	if (!chain.length) {
		throw apiError(503, 'no_model_available', 'No model lane is available right now. Retry shortly, or name a paid model to use your credits.');
	}

	const history = await threadHistoryForModel({ agentId: agent.id, userId, limit: 23 });
	const userRow = await appendThreadMessage({ agentId: agent.id, userId, role: 'user', content: message, channel, freeTier: free });

	const events = [];
	const loop = createAgentLoop({
		chain,
		toolSchemas: tools ? agentToolSchemas() : [],
		toolHandlers: tools ? agentToolHandlers() : {},
		maxToolRounds: MAX_TOOL_ROUNDS,
		temperature,
		onEvent: (e) => {
			events.push(e);
		},
	});
	const start = initialLoopState({
		operationId: randomUUID(),
		maxSteps: MAX_RUNTIME_STEPS,
		messages: [{ role: 'system', content: await systemPrompt(agent) }, ...history, { role: 'user', content: message }],
	});
	let finalState;
	try {
		({ state: finalState } = await runLoopToEnd(loop, start));
	} catch (err) {
		throw apiError(503, 'model_unavailable', 'The agent could not reach a model to answer. Retry shortly.', {
			reason: String(err?.message || err).slice(0, 200),
		});
	}

	// Charge every model call the reply made (free-tier calls cost nothing).
	const modelCalls = events.filter((e) => e.kind === 'model_call');
	let chargedUsd = 0;
	let shortfallUsd = 0;
	let inputTokens = 0;
	let outputTokens = 0;
	let costMicroUsd = 0;
	for (const [i, e] of modelCalls.entries()) {
		inputTokens += e.usage?.input || 0;
		outputTokens += e.usage?.output || 0;
		costMicroUsd += e.free ? 0 : Number(e.costMicroUsd || 0);
		const r = await chargeCall({ userId, agentId: agent.id, callId: `msg:${userRow.id}:${i + 1}`, event: e, model, free });
		chargedUsd += r.chargedUsd;
		shortfallUsd += r.shortfallUsd;
	}
	const last = modelCalls.at(-1) || null;
	const content = finalAnswer(finalState) || (finalState.status === 'error' ? '' : 'I have nothing to add to that.');
	if (!content) {
		throw apiError(503, 'model_unavailable', 'The agent loop ended without an answer. Retry shortly.', {
			reason: finalState.error?.message || null,
		});
	}
	const toolCalls = toolCallsFrom(events);
	const assistant = await appendThreadMessage({
		agentId: agent.id,
		userId,
		role: 'assistant',
		content,
		channel,
		toolCalls,
		model: last?.model ?? null,
		provider: last?.provider ?? null,
		inputTokens,
		outputTokens,
		costMicroUsd: Math.round(costMicroUsd),
		chargedUsd,
	});

	return {
		id: Number(assistant.id),
		role: 'assistant',
		content,
		model: last?.model ?? null,
		provider: last?.provider ?? null,
		usage: { inputTokens, outputTokens, modelCalls: modelCalls.length, estimated: modelCalls.some((e) => e.usage?.estimated) },
		costCredits: Math.round(chargedUsd * 1e6) / 1e6,
		shortfallCredits: Math.round(shortfallUsd * 1e6) / 1e6,
		freeTier: free,
		toolCalls,
		// The chat tool registry is read-only: a reply never signs. Fund-moving
		// work goes through the wallet and swap routes, which report their own.
		signatures: [],
		channel,
		createdAt: assistant.created_at,
	};
}

/** The thread, newest first, paged with `before` (a message id). */
export async function getMessages(agent, userId, query) {
	const limit = intParam(query.limit, { name: 'limit', min: 1, max: 100, fallback: 30 });
	const before = strParam(query.before, { name: 'before', max: 20 });
	if (before && !/^\d+$/.test(before)) {
		throw apiError(400, 'invalid_parameter', 'before must be a cursor returned in meta.nextCursor.', { parameter: 'before' });
	}
	const { messages, hasMore } = await listThread({ agentId: agent.id, userId, limit, before });
	return page(messages, { hasMore, nextCursor: hasMore && messages.length ? String(messages.at(-1).id) : null });
}

/** Count of the caller's messages to one agent today, for the agent listing. */
export async function messagesToday(agentId, userId) {
	const [r] = await sql`
		SELECT count(*)::int AS n FROM agent_messages
		WHERE agent_id = ${agentId} AND user_id = ${userId} AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
	`;
	return r?.n || 0;
}
