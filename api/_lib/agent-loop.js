// api/_lib/agent-loop.js: the server-side agent tool loop, one step at a time.
//
// Extracted from api/agent/run.js so the chat completion route and v1 runs
// (api/_lib/agents-v1/runs.js) drive the SAME loop: the LLM is called over the
// shared tool-calling chain (api/_lib/llm-tool-chain.js), every planned tool
// call is preflighted through the GuardChain in headless mode, and allowed
// calls execute from the read-only registry (api/_lib/agent-tools.js).
//
// The loop is expressed as `step(state, context)` over @three-ws/agent-runtime's
// AgentRuntime, whose state and context are plain JSON. A caller that runs the
// loop inline just steps until done; a caller that must survive an instance
// change (a run) persists `{ state, context }` after every step and resumes
// from it anywhere. Nothing in the runner keeps state outside those two
// objects, which is what makes the checkpoint sufficient.

import { AgentRuntime, GuardChain, TradeGuard } from '@three-ws/agent-runtime';
import { streamRound } from './llm-tool-chain.js';
import { costMicroUsd, isFreeLane } from './llm-pricing.js';

const guardChain = new GuardChain({ defiGuard: new TradeGuard() });

export const AGENT_SYSTEM_NOTE = [
	'You have server-side tools: live token prices and trends, web search, Solana balances, a rug/honeypot safety verdict, smart-money activity, and .sol name resolution.',
	'Use them instead of guessing; never invent prices, balances, or safety verdicts. If a tool returns no data, say so plainly.',
	'You cannot move funds: no tool here transfers, swaps, or signs anything.',
].join(' ');

const MAX_TOOL_OUTPUT_CHARS = 20_000;

/** Rough token count for a lane that streams no usage chunk (about 4 chars per token). */
function estimateTokens(value) {
	const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
	return Math.ceil(text.length / 4);
}

/**
 * Initial `{ state, context }` for a loop over `messages`.
 * @param {{ operationId: string, messages: Array<{role: string, content: any}>, maxSteps: number }} o
 */
export function initialLoopState({ operationId, messages, maxSteps }) {
	const state = AgentRuntime.createInitialState({ operationId, maxSteps });
	state.messages = messages;
	return { state, context: undefined };
}

/** Whether a loop state has reached a terminal status. */
export function loopFinished(state, context) {
	return state.status === 'done' || state.status === 'error' || (!context && state.stepCount > 0);
}

/** The last assistant answer in a loop's transcript. */
export function finalAnswer(state) {
	for (let i = state.messages.length - 1; i >= 0; i--) {
		const m = state.messages[i];
		if (m.role === 'assistant' && !m.tool_calls && typeof m.content === 'string') return m.content;
	}
	return '';
}

/**
 * Build a steppable agent loop.
 *
 * @param {object} o
 * @param {Array<object>} o.chain           provider rungs, in failover order
 * @param {Array<object>} o.toolSchemas     OpenAI function schemas the model may call
 * @param {Record<string, Function>} o.toolHandlers  name → handler(args)
 * @param {number} [o.maxToolRounds]        tool rounds before the model must answer
 * @param {number} [o.temperature]
 * @param {(delta: string) => void} [o.onContent]  streamed assistant text
 * @param {(event: object) => void|Promise<void>} [o.onEvent]  model_call / tool_call / tool_blocked / tool_result
 * @param {(name: string, args: object) => Promise<string|null>} [o.preflight]  extra per-call gate; a string blocks with that reason
 */
export function createAgentLoop({
	chain,
	toolSchemas,
	toolHandlers,
	maxToolRounds = 4,
	temperature = 0.4,
	onContent,
	onEvent,
	preflight,
}) {
	const emit = async (event) => {
		if (onEvent) await onEvent(event);
	};

	// One round over the provider chain, failing over BEFORE any byte streams and
	// aborting (not retrying) after a mid-stream death so a listener never sees
	// the same sentence twice.
	async function* modelRuntime(payload) {
		let lastErr = null;
		for (const provider of chain) {
			let emittedHere = false;
			const started = Date.now();
			try {
				const out = await streamRound(provider, {
					messages: payload.messages,
					tools: toolSchemas,
					temperature,
					onContent: (delta) => {
						emittedHere = true;
						onContent?.(delta);
					},
				});
				const model = provider.catalogModel || provider.model;
				const estimated = !out.usage;
				const input = out.usage ? out.usage.input : estimateTokens(payload.messages);
				const output = out.usage ? out.usage.output : estimateTokens(out.content) + estimateTokens(out.toolCalls);
				const cost = costMicroUsd({
					provider: provider.name,
					model,
					input,
					output,
					reportedCostUsd: out.usage?.reportedCostUsd ?? null,
				});
				await emit({
					kind: 'model_call',
					provider: provider.name,
					model,
					free: isFreeLane(provider.name, model),
					content: out.content,
					toolCalls: out.toolCalls.map((tc) => ({ id: tc.id, name: tc.name, args: tc.args })),
					usage: { input, output, estimated },
					costMicroUsd: cost,
					latencyMs: Date.now() - started,
				});
				yield {
					content: out.content,
					tool_calls: out.toolCalls.map((tc) => ({
						id: tc.id,
						type: 'function',
						function: { name: tc.name, arguments: tc.args || '{}' },
					})),
				};
				return;
			} catch (err) {
				lastErr = err;
				if (emittedHere) throw err;
			}
		}
		throw lastErr || new Error('No LLM provider available');
	}

	// Handlers never throw into the runtime: a failing tool becomes an error
	// result the model can read and route around, instead of ending the turn.
	const handlers = {};
	for (const [name, handler] of Object.entries(toolHandlers)) {
		handlers[name] = async (args) => {
			const started = Date.now();
			let result;
			let failed = null;
			try {
				result = await handler(args);
			} catch (err) {
				failed = String(err?.message || err).slice(0, 300);
				result = { error: failed };
			}
			let serialized = JSON.stringify(result ?? null);
			if (serialized.length > MAX_TOOL_OUTPUT_CHARS) {
				result = { truncated: true, preview: serialized.slice(0, MAX_TOOL_OUTPUT_CHARS) };
				serialized = JSON.stringify(result);
			}
			await emit({ kind: 'tool_result', tool: name, args, result, error: failed, latencyMs: Date.now() - started });
			return result;
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
				const roundsUsed = state.messages.filter((m) => m.role === 'assistant' && m.tool_calls).length;

				if (Array.isArray(toolCalls) && toolCalls.length > 0 && roundsUsed < maxToolRounds) {
					state.messages.push({ role: 'assistant', content: content || null, tool_calls: toolCalls });

					const allowed = [];
					for (const tc of toolCalls) {
						const name = tc.function?.name || '';
						let args = {};
						try {
							args = JSON.parse(tc.function?.arguments || '{}');
						} catch {
							args = {};
						}
						const block = async (reason) => {
							state.messages.push({
								role: 'tool',
								tool_call_id: tc.id,
								content: JSON.stringify({ blocked: true, error: reason }),
							});
							await emit({ kind: 'tool_blocked', tool: name, args, reason });
						};
						if (!handlers[name]) {
							await block(`Unknown tool: ${name}`);
							continue;
						}
						const verdict = await guardChain.evaluate({
							identifier: name,
							apiName: name,
							arguments: args,
							approvalMode: 'headless',
						});
						if (verdict.decision === 'block') {
							await block(verdict.reason);
							continue;
						}
						const extra = preflight ? await preflight(name, args) : null;
						if (extra) {
							await block(extra);
							continue;
						}
						await emit({ kind: 'tool_call', tool: name, args });
						allowed.push(tc);
					}

					if (allowed.length > 0) return { type: 'call_tools_batch', payload: allowed };
					// Everything was blocked or unknown: let the model read the errors.
					return { type: 'call_llm', payload: { messages: state.messages } };
				}

				state.messages.push({ role: 'assistant', content });
				return { type: 'finish', reason: 'completed' };
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

	return {
		/**
		 * Advance one step. Returns the next `{ state, context }`; the loop is over
		 * when `loopFinished(state, context)` holds.
		 */
		async step(state, context) {
			const out = await runtime.step(state, context);
			return { state: out.newState, context: out.nextContext };
		},
	};
}

/**
 * Run a loop to completion inline. `shouldContinue` is consulted before every
 * step; returning false stops the loop where it stands.
 */
export async function runLoopToEnd(loop, { state, context }, { shouldContinue } = {}) {
	while (!loopFinished(state, context)) {
		if (shouldContinue && !(await shouldContinue(state))) break;
		({ state, context } = await loop.step(state, context));
	}
	return { state, context };
}
