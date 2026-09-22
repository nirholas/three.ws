// The local agent loop: the server loop's shape (api/_lib/agent-loop.js),
// running on this machine over @three-ws/agent-runtime's AgentRuntime.
//
//   call the model with this turn's tool list, streaming text to the UI
//   → every planned tool call passes the GuardChain (headless) and then the
//     approval gate for its class (read, write, shell, network, financial)
//   → allowed calls run concurrently, rejected ones return an error result the
//     model can read and route around
//   → repeat until the model answers, the turn's tool budget is spent (the
//     model is then asked to answer with no tools), or the turn is interrupted
//
// State and context stay plain JSON, so a turn is inspectable and a session's
// transcript is exactly `state.messages`.

import { AgentRuntime, GuardChain, TradeGuard } from '@three-ws/agent-runtime';

const guardChain = new GuardChain({ defiGuard: new TradeGuard() });

export const MAX_TOOL_OUTPUT_CHARS = 24_000;

export class InterruptedError extends Error {
	constructor() {
		super('interrupted');
		this.name = 'InterruptedError';
		this.code = 'aborted';
	}
}

/** Tool rounds taken since the latest user message. */
export function roundsThisTurn(messages) {
	let n = 0;
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m.role === 'user') break;
		if (m.role === 'assistant' && m.tool_calls?.length) n++;
	}
	return n;
}

export function serializeToolResult(result) {
	let text = typeof result === 'string' ? result : JSON.stringify(result ?? null);
	if (text.length > MAX_TOOL_OUTPUT_CHARS) text = `${text.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n[truncated: ${text.length - MAX_TOOL_OUTPUT_CHARS} more characters]`;
	return text;
}

/**
 * Decide whether a call may run. Returns null when allowed, or the reason it was not.
 * @param {object} o
 * @param {{ name: string, toolClass: string }} o.tool
 * @param {object} o.args
 * @param {Record<string,string>} o.approvals   class → ask | allow | deny
 * @param {Function|null} o.approve             async ({ tool, args }) => { ok, reason? }
 */
export async function gateCall({ tool, args, approvals, approve }) {
	const cls = tool.toolClass || 'write';
	const mode = cls === 'financial' && approvals[cls] === 'allow' ? 'ask' : approvals[cls] || 'ask';
	if (mode === 'allow') return null;
	if (mode === 'deny') return `${tool.name} is a ${cls} tool and ${cls} tools are turned off (approvals.${cls} = deny in agent.json).`;
	if (!approve) {
		return `${tool.name} is a ${cls} tool and needs a person to approve it, and nobody is at the keyboard for this run. Say what you would have done instead.`;
	}
	const answer = await approve({ tool, args });
	if (answer?.ok) return null;
	return answer?.reason || `The person declined ${tool.name}. Do not retry it; continue without it or ask them what they want instead.`;
}

/**
 * Run one turn: `messages` already ends with the user's message.
 *
 * @param {object} o
 * @param {{ round: Function }} o.model
 * @param {ReturnType<import('./tools/registry.js').createToolset>} o.toolset
 * @param {Array<object>} o.messages       full transcript (system first); mutated in place
 * @param {string} o.query                 the request used to pick relevant remote tools
 * @param {string[]} [o.recentTools]
 * @param {Record<string,string>} o.approvals
 * @param {Function|null} [o.approve]
 * @param {{ maxToolRounds: number, maxSteps: number }} o.budget
 * @param {AbortSignal} [o.signal]
 * @param {(delta: string) => void} [o.onContent]
 * @param {(event: object) => void} [o.onEvent]
 * @returns {Promise<{ answer: string, messages: object[], usage: { prompt_tokens: number, completion_tokens: number }, billedUsd: number, toolsUsed: string[] }>}
 */
export async function runTurn({ model, toolset, messages, query, recentTools = [], approvals, approve = null, budget, signal, onContent, onEvent }) {
	const emit = (e) => onEvent?.(e);
	const usage = { prompt_tokens: 0, completion_tokens: 0 };
	let billedUsd = 0;
	const toolsUsed = [];
	const pendingIds = new Map();
	let turnTools = toolset.schemasFor(query, recentTools);

	const checkAbort = () => {
		if (signal?.aborted) throw new InterruptedError();
	};

	async function* modelRuntime(payload) {
		checkAbort();
		const spent = roundsThisTurn(payload.messages) >= budget.maxToolRounds;
		const tools = spent ? [] : turnTools;
		emit({ kind: 'model_start', tools: tools.length });
		let out;
		try {
			out = await model.round({ messages: payload.messages, tools, signal, onContent });
		} catch (err) {
			if (signal?.aborted || err?.code === 'aborted') throw new InterruptedError();
			throw err;
		}
		if (out.usage) {
			usage.prompt_tokens += out.usage.prompt_tokens || 0;
			usage.completion_tokens += out.usage.completion_tokens || 0;
		}
		if (out.billing?.charged_usd) billedUsd += Number(out.billing.charged_usd) || 0;
		emit({ kind: 'model_end', usage: out.usage || null, billing: out.billing || null, toolCalls: out.toolCalls.length });
		yield { content: out.content, tool_calls: spent ? [] : out.toolCalls };
	}

	const handlers = {};
	for (const t of toolset.all()) {
		handlers[t.name] = async (args) => {
			const id = pendingIds.get(t.name)?.shift() || null;
			const started = Date.now();
			emit({ kind: 'tool_start', id, name: t.name, args, toolClass: t.toolClass, source: t.source });
			let result;
			let error = null;
			try {
				checkAbort();
				result = await t.run(args, {
					signal,
					onProgress: (p) => emit({ kind: 'tool_progress', id, name: t.name, ...p }),
				});
			} catch (err) {
				error = signal?.aborted ? 'interrupted' : String(err?.message || err).slice(0, 500);
				result = { error };
			}
			if (!toolsUsed.includes(t.name)) toolsUsed.push(t.name);
			emit({ kind: 'tool_end', id, name: t.name, result, error, ms: Date.now() - started });
			return serializeToolResult(result);
		};
	}

	const runner = async (context, state) => {
		switch (context.phase) {
			case 'init':
			case 'user_input':
				return { type: 'call_llm', payload: { messages: state.messages } };

			case 'llm_result': {
				const { result, toolCalls } = context.payload || {};
				const content = result?.content || '';
				if (!Array.isArray(toolCalls) || !toolCalls.length) {
					state.messages.push({ role: 'assistant', content });
					return { type: 'finish', reason: 'completed' };
				}
				state.messages.push({ role: 'assistant', content: content || null, tool_calls: toolCalls });
				const allowed = [];
				for (const tc of toolCalls) {
					checkAbort();
					const name = tc.function?.name || '';
					const reject = (reason) => {
						state.messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ blocked: true, error: reason }) });
						emit({ kind: 'tool_blocked', id: tc.id, name, reason });
					};
					const tool = toolset.get(name);
					if (!tool) {
						reject(`Unknown tool: ${name}. Use only the tools you were given.`);
						continue;
					}
					let args;
					try {
						args = JSON.parse(tc.function?.arguments || '{}');
						if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('arguments must be a JSON object');
					} catch (err) {
						reject(`The arguments for ${name} were not valid JSON (${err.message}). Call it again with a JSON object.`);
						continue;
					}
					const verdict = await guardChain.evaluate({ identifier: name, apiName: name, arguments: args, approvalMode: 'headless' });
					if (verdict.decision === 'block') {
						reject(verdict.reason || 'blocked by the guard chain');
						continue;
					}
					const refused = await gateCall({ tool, args, approvals, approve });
					checkAbort();
					if (refused) {
						reject(refused);
						continue;
					}
					if (!pendingIds.has(name)) pendingIds.set(name, []);
					pendingIds.get(name).push(tc.id);
					allowed.push({ ...tc, function: { ...tc.function, arguments: JSON.stringify(args) } });
				}
				if (!allowed.length) return { type: 'call_llm', payload: { messages: state.messages } };
				// Remote tools the model reached for stay offered for the rest of the turn.
				const names = new Set(turnTools.map((t) => t.function.name));
				if (allowed.some((tc) => !names.has(tc.function.name))) turnTools = toolset.schemasFor(query, [...recentTools, ...toolsUsed]);
				return { type: 'call_tools_batch', payload: allowed };
			}

			case 'tool_result':
			case 'tools_batch_result':
				return { type: 'call_llm', payload: { messages: state.messages } };

			case 'error':
				return { type: 'finish', reason: 'error_recovery' };

			default:
				return { type: 'finish', reason: 'agent_decision' };
		}
	};

	const runtime = new AgentRuntime({ runner, modelRuntime, tools: handlers });
	let state = AgentRuntime.createInitialState({ operationId: `turn-${Date.now().toString(36)}`, maxSteps: budget.maxSteps });
	state.messages = messages.slice();
	let context;
	for (;;) {
		checkAbort();
		const step = await runtime.step(state, context);
		state = step.newState;
		context = step.nextContext;
		if (state.status === 'error') {
			if (signal?.aborted) throw new InterruptedError();
			const err = state.error;
			throw err instanceof Error ? err : new Error(String(err?.message || err || 'agent loop error'));
		}
		if (state.status === 'done' || !context) break;
	}
	// The runtime ends a turn that ran past maxSteps without a final answer.
	const last = state.messages.at(-1);
	if (!(last?.role === 'assistant' && !last.tool_calls?.length)) {
		state.messages.push({ role: 'assistant', content: `I stopped after ${budget.maxSteps} steps, the step budget for one turn. Say "continue" if you want me to keep going.` });
	}
	let answer = '';
	for (let i = state.messages.length - 1; i >= 0; i--) {
		const m = state.messages[i];
		if (m.role === 'assistant' && !m.tool_calls?.length) {
			answer = m.content || '';
			break;
		}
	}
	return { answer, messages: state.messages, usage, billedUsd, toolsUsed };
}
