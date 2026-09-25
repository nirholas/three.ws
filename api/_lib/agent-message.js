// One agent turn on a chosen model: persona in, answer out.
//
// The model is decided by api/_lib/agent-model.js (per-message override, then
// the agent's default, then the platform chain). This module runs the turn:
// the agent's persona and the server tool note as the system prompt, the
// read-only tool registry (api/_lib/agent-tools.js) when the model can call
// tools, and the shared step loop (api/_lib/agent-loop.js), which fails over
// across the chain before any byte streams.
//
// It does no billing and writes no thread rows: callers own those, because
// they differ (the v1 messages API bills credits and writes the owner's thread;
// call_agent answers a stranger and writes nothing). Every caller gets back the
// same summary: the answer, the model that actually served it, token usage,
// platform cost, and the tool calls made.

import { agentToolSchemas, agentToolHandlers } from './agent-tools.js';
import { AGENT_SYSTEM_NOTE, createAgentLoop, finalAnswer, initialLoopState, loopFinished } from './agent-loop.js';
import { modelChain } from './agent-model.js';

const MAX_TOOL_ROUNDS = 4;
const MAX_PERSONA_CHARS = 8000;

/**
 * The system prompt an agent answers under: its persona (or a name and
 * description fallback), the platform's one-coin rule, and the tool note when
 * tools are offered.
 * @param {{ name?: string, description?: string, persona_prompt?: string, system_prompt?: string, meta?: object }} agent
 * @param {{ tools: boolean }} o
 */
export function agentSystemPrompt(agent, { tools }) {
	const name = String(agent?.name || 'this agent').trim() || 'this agent';
	const persona = String(agent?.persona_prompt || agent?.system_prompt || agent?.meta?.brain?.instructions || '').trim();
	const desc = String(agent?.description || '').trim();
	const parts = [persona ? persona.slice(0, MAX_PERSONA_CHARS) : `You are ${name}, an agent on three.ws.${desc ? ` ${desc}` : ''}`];
	parts.push(
		'If tokens or coins come up, the only coin you may name, endorse, or recommend is $THREE ' +
			'(contract FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump).',
	);
	if (tools) parts.push(AGENT_SYSTEM_NOTE);
	return parts.join('\n\n');
}

/**
 * Run one turn.
 *
 * @param {object} o
 * @param {object} o.agent                 agent_identities row (name, persona_prompt, description, meta)
 * @param {string} o.message               the user's message
 * @param {Array<{role:'user'|'assistant', content:string}>} [o.history]  prior turns, oldest first
 * @param {string|null} [o.model]          resolved catalog id, or null for the platform chain
 * @param {number|null} [o.temperature]
 * @param {string} [o.operationId]
 * @returns {Promise<{
 *   content: string, model: string|null, provider: string|null, tools: boolean,
 *   usage: { input: number, output: number, estimated: boolean },
 *   costMicroUsd: number|null, modelCalls: object[],
 *   toolCalls: Array<{ name: string, args: object, error: string|null }>,
 * }>}
 */
export async function runAgentMessage({ agent, message, history = [], model = null, temperature = null, operationId }) {
	const { chain, tools } = modelChain(model);
	if (!chain.length) {
		throw Object.assign(new Error('No language model is reachable on this deployment right now.'), {
			status: 503,
			code: 'llm_unavailable',
			expose: true,
		});
	}

	const messages = [
		{ role: 'system', content: agentSystemPrompt(agent, { tools }) },
		...history.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content),
		{ role: 'user', content: String(message) },
	];

	const modelCalls = [];
	const toolCalls = [];
	const loop = createAgentLoop({
		chain,
		toolSchemas: tools ? agentToolSchemas() : [],
		toolHandlers: tools ? agentToolHandlers() : {},
		maxToolRounds: MAX_TOOL_ROUNDS,
		...(temperature != null ? { temperature } : {}),
		onEvent: (event) => {
			if (event.kind === 'model_call') modelCalls.push(event);
			if (event.kind === 'tool_result') toolCalls.push({ name: event.tool, args: event.args, error: event.error || null });
			if (event.kind === 'tool_blocked') toolCalls.push({ name: event.tool, args: event.args, error: `blocked: ${event.reason}` });
		},
	});

	let { state, context } = initialLoopState({
		operationId: operationId || `msg-${Date.now().toString(36)}`,
		messages,
		maxSteps: MAX_TOOL_ROUNDS * 2 + 3,
	});
	while (!loopFinished(state, context)) {
		({ state, context } = await loop.step(state, context));
	}
	if (state.status === 'error') {
		const detail = String(state.error?.message || state.error || 'the model could not answer').slice(0, 300);
		throw Object.assign(new Error(detail), { status: 502, code: 'model_failed', expose: true });
	}

	const last = modelCalls.at(-1) || null;
	const usage = { input: 0, output: 0, estimated: false };
	let costMicroUsd = 0;
	for (const call of modelCalls) {
		usage.input += call.usage?.input || 0;
		usage.output += call.usage?.output || 0;
		if (call.usage?.estimated) usage.estimated = true;
		costMicroUsd = costMicroUsd == null || call.costMicroUsd == null ? null : costMicroUsd + call.costMicroUsd;
	}
	return {
		content: finalAnswer(state),
		model: last?.model || model,
		provider: last?.provider || null,
		tools,
		usage,
		costMicroUsd,
		modelCalls,
		toolCalls,
	};
}
