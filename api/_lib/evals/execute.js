// Execute one eval conversation through the real agent loop and record it.
//
// This is the same loop /api/agent/run and v1 runs drive (api/_lib/agent-loop.js):
// the same GuardChain preflight, the same read-only tool registry, the same
// streamed tool calling. What differs is only what an eval needs to measure:
//
//   • one pinned model rung (api/_lib/evals/models.js), no failover;
//   • a tool allowlist, the intersection of the task's tools and the
//     configuration's tools;
//   • sandbox tools, whose handler returns the preview declared in the suite
//     and never executes anything;
//   • preview-only mode (replay), in which ONLY the read-only registry runs,
//     tools with side effects answer with a sandbox preview, and any other
//     tool call is blocked before it reaches a handler;
//   • a trace of every model call, tool call, block and result, with tokens,
//     cost and latency, which the checks score and the report keeps.

import { AGENT_TOOLS } from '../agent-tools.js';
import { AGENT_SYSTEM_NOTE, createAgentLoop, finalAnswer, initialLoopState, runLoopToEnd } from '../agent-loop.js';
import { isInfraError } from './models.js';

const RESULT_PREVIEW_CHARS = 1200;
const DEFAULT_DEADLINE_MS = 120_000;
const RETRY_DELAYS_MS = [2_000, 6_000];

export const SANDBOX_NOTE =
	'Some tools are sandboxed for this session: calling one returns a preview of what it would do and executes nothing. Treat a preview as a preview, never as a completed action.';

const READ_ONLY_TOOLS = new Set(Object.keys(AGENT_TOOLS));

function preview(value) {
	const s = JSON.stringify(value ?? null);
	return s.length > RESULT_PREVIEW_CHARS ? `${s.slice(0, RESULT_PREVIEW_CHARS)}…` : s;
}

/** The handler a sandbox tool gets: it echoes the request and its preview, and executes nothing. */
export function sandboxHandler(tool) {
	return async (args) => ({ preview: true, executed: false, tool: tool.name, request: args ?? {}, ...tool.preview });
}

/**
 * The tool surface one conversation sees.
 * @param {{ allowed: string[], sandbox?: object[], previewOnly?: boolean }} o
 */
export function buildToolSurface({ allowed, sandbox = [], previewOnly = false }) {
	const schemas = [];
	const handlers = {};
	const sandboxNames = new Set();
	for (const name of allowed) {
		const t = AGENT_TOOLS[name];
		if (!t) continue;
		schemas.push({ type: 'function', function: { name, description: t.description, parameters: t.parameters } });
		handlers[name] = t.handler;
	}
	for (const tool of sandbox) {
		if (!allowed.includes(tool.name) || READ_ONLY_TOOLS.has(tool.name)) continue;
		schemas.push({
			type: 'function',
			function: { name: tool.name, description: `[preview] ${tool.description}`, parameters: tool.parameters },
		});
		handlers[tool.name] = sandboxHandler(tool);
		sandboxNames.add(tool.name);
	}
	// Belt and braces for preview-only: nothing outside the read-only registry
	// can hold a handler other than the sandbox preview, whatever the caller
	// passed.
	if (previewOnly) {
		for (const name of Object.keys(handlers)) {
			if (!READ_ONLY_TOOLS.has(name) && !sandboxNames.has(name)) delete handlers[name];
		}
	}
	return { schemas, handlers, sandboxNames };
}

/** The system messages a configuration speaks with, in the order /api/agent/run uses. */
export function systemMessages(systemPrompt, { sandboxed = false } = {}) {
	const out = [];
	if (systemPrompt) out.push({ role: 'system', content: systemPrompt });
	out.push({ role: 'system', content: AGENT_SYSTEM_NOTE });
	if (sandboxed) out.push({ role: 'system', content: SANDBOX_NOTE });
	return out;
}

/**
 * Run one conversation to its final answer and return its trace.
 *
 * @param {object} o
 * @param {Array<{role: string, content: string}>} o.messages  full prompt, system messages included
 * @param {object} o.rung              the pinned provider rung
 * @param {string[]} o.allowed         tool names the model may call
 * @param {object[]} [o.sandbox]       sandbox tool definitions
 * @param {boolean} [o.previewOnly]    only read-only registry tools execute; sandbox tools preview; all else is blocked
 * @param {number} [o.temperature]
 * @param {number} [o.maxToolRounds]
 * @param {number} [o.deadlineMs]
 */
export async function executeConversation({
	messages,
	rung,
	allowed,
	sandbox = [],
	previewOnly = false,
	temperature = 0.2,
	maxToolRounds = 4,
	deadlineMs = DEFAULT_DEADLINE_MS,
}) {
	const { schemas, handlers, sandboxNames } = buildToolSurface({ allowed, sandbox, previewOnly });
	const events = [];
	const toolCalls = [];
	const pending = new Map();
	const tokens = { input: 0, output: 0, estimated: false };
	let costMicro = 0;
	let modelCalls = 0;
	let lane = null;
	const started = Date.now();

	const loop = createAgentLoop({
		chain: [rung],
		toolSchemas: schemas,
		toolHandlers: handlers,
		maxToolRounds,
		temperature,
		preflight: async (name) => {
			if (previewOnly && !READ_ONLY_TOOLS.has(name) && !sandboxNames.has(name)) {
				return `Preview-only replay: ${name} would have run here and was not executed.`;
			}
			return null;
		},
		onEvent: (e) => {
			const at = Date.now() - started;
			if (e.kind === 'model_call') {
				modelCalls++;
				lane = { provider: e.provider, model: e.model };
				tokens.input += e.usage?.input || 0;
				tokens.output += e.usage?.output || 0;
				if (e.usage?.estimated) tokens.estimated = true;
				costMicro = costMicro == null || e.costMicroUsd == null ? null : costMicro + e.costMicroUsd;
				events.push({
					kind: 'model_call',
					at,
					provider: e.provider,
					model: e.model,
					content: e.content || '',
					toolCalls: (e.toolCalls || []).map((tc) => ({ name: tc.name, args: tc.args })),
					usage: e.usage,
					costMicroUsd: e.costMicroUsd,
					latencyMs: e.latencyMs,
				});
			} else if (e.kind === 'tool_call') {
				const call = { tool: e.tool, args: e.args || {}, sandboxed: sandboxNames.has(e.tool), blocked: false };
				toolCalls.push(call);
				pending.set(e.tool, [...(pending.get(e.tool) || []), call]);
				events.push({ kind: 'tool_call', at, tool: e.tool, args: e.args || {}, sandboxed: call.sandboxed });
			} else if (e.kind === 'tool_blocked') {
				toolCalls.push({ tool: e.tool, args: e.args || {}, sandboxed: false, blocked: true, reason: e.reason });
				events.push({ kind: 'tool_blocked', at, tool: e.tool, args: e.args || {}, reason: e.reason });
			} else if (e.kind === 'tool_result') {
				const queue = pending.get(e.tool) || [];
				const call = queue.shift();
				if (call) {
					call.error = e.error || null;
					call.latencyMs = e.latencyMs;
					call.result = preview(e.result);
				}
				events.push({ kind: 'tool_result', at, tool: e.tool, error: e.error || null, result: preview(e.result), latencyMs: e.latencyMs });
			}
		},
	});

	let state;
	let error = null;
	let timedOut = false;
	try {
		({ state } = await runLoopToEnd(
			loop,
			initialLoopState({ operationId: `eval-${started.toString(36)}`, messages, maxSteps: maxToolRounds * 2 + 3 }),
			{
				shouldContinue: () => {
					if (Date.now() - started < deadlineMs) return true;
					timedOut = true;
					return false;
				},
			},
		));
		if (state.status === 'error') error = String(state.error?.message || state.error || 'agent loop error');
		else if (timedOut) error = `timed out after ${Math.round(deadlineMs / 1000)}s`;
	} catch (err) {
		error = String(err?.message || err);
	}

	const executedTools = toolCalls.filter((c) => !c.blocked).length;
	return {
		status: error ? 'error' : 'completed',
		error: error ? error.slice(0, 500) : null,
		infra: Boolean(error) && (timedOut || isInfraError(error)),
		answer: state ? finalAnswer(state) : '',
		model: rung.catalogModel || rung.model,
		provider: rung.name,
		lane,
		steps: modelCalls + executedTools,
		modelCalls,
		toolCalls,
		events,
		tokens,
		costUsd: costMicro == null ? null : costMicro / 1_000_000,
		latencyMs: Date.now() - started,
	};
}

/**
 * Run one suite task against a configuration on a pinned rung. Infrastructure
 * errors (throttles, outages) are retried with a backoff; a task that still
 * cannot reach its model comes back `infra: true` so it is reported as errored
 * rather than scored.
 */
export async function runTask(task, config, { rung, suiteDefaults = {}, deadlineMs, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
	const requested = Array.isArray(task.tools) ? task.tools : Object.keys(AGENT_TOOLS);
	const sandboxNames = new Set((task.sandbox || []).map((t) => t.name));
	// Sandbox tools belong to the task, so a configuration's allowlist never
	// hides them; registry tools must be allowed by both.
	const allowed = requested.filter((name) => sandboxNames.has(name) || config.tools.includes(name));
	const messages = [...systemMessages(config.systemPrompt, { sandboxed: sandboxNames.size > 0 }), { role: 'user', content: task.prompt }];

	let trace;
	for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
		trace = await executeConversation({
			messages,
			rung,
			allowed,
			sandbox: task.sandbox || [],
			temperature: config.temperature ?? suiteDefaults.temperature ?? 0.2,
			maxToolRounds: task.maxToolRounds ?? suiteDefaults.maxToolRounds ?? 4,
			deadlineMs,
		});
		trace.attempts = attempt + 1;
		if (!trace.infra || attempt === RETRY_DELAYS_MS.length) break;
		await sleep(RETRY_DELAYS_MS[attempt]);
	}
	trace.allowedTools = allowed;
	return trace;
}
