// How a running agent meets its memory: the one entry point every server
// runtime calls before a turn and after a run.
//
//   learningContext()   before a turn: the ranked, bounded memory section for
//                       the system prompt, the learning tools bound to this
//                       (agent, account), and whether this turn carries the
//                       memory nudge. Everything is empty when the account
//                       switched memory off at /settings/memory.
//   afterRunCompleted() after a run succeeds: drafts a prompt-only skill from
//                       the run's tool trace when it qualifies (skill-drafts.js).
//
// Both are best-effort by design: a memory-store hiccup degrades to a turn
// without memory, never to a failed turn.

import { getMemorySettings } from './settings.js';
import { memoryPromptSection } from './memory.js';
import { memoryNudge, shouldNudge } from './nudge.js';
import { draftSkillFromRun } from './skill-drafts.js';
import { AUTONOMOUS_TOOL_NAMES, LEARNING_TOOL_NAMES, isLearningTool, learningToolHandlers, learningToolSchemas } from './tools.js';

const OFF = Object.freeze({ enabled: false, block: '', memoryIds: [], nudge: null, toolNames: [], schemas: [], handlers: {}, settings: null });

/**
 * @param {object} o
 * @param {string} o.agentId
 * @param {string} o.userId
 * @param {string} [o.query]          the message or goal this turn is about (pins relevant memories)
 * @param {'chat'|'run'|'mcp'|'tool'} [o.source]
 * @param {string|null} [o.runRef]    run id (or completion id) the writes are attributed to
 * @param {boolean} [o.autonomous]    an unattended run: no irreversible tools
 * @param {number|null} [o.userTurns] user turns so far, current included; drives the every-N nudge
 * @param {boolean} [o.endOfRun]      this loop ends a run, so it carries the end-of-run nudge
 */
export async function learningContext({ agentId, userId, query = '', source = 'tool', runRef = null, autonomous = false, userTurns = null, endOfRun = false }) {
	if (!agentId || !userId) return OFF;
	let settings;
	try {
		settings = await getMemorySettings(userId);
	} catch (err) {
		console.warn('[agent-learning] settings read failed', err?.message);
		return OFF;
	}
	if (!settings.enabled) return { ...OFF, settings };

	let section = { block: '', memoryIds: [] };
	try {
		section = await memoryPromptSection({ agentId, userId, query });
	} catch (err) {
		console.warn('[agent-learning] memory section failed', err?.message);
	}

	const toolNames = autonomous ? [...AUTONOMOUS_TOOL_NAMES] : [...LEARNING_TOOL_NAMES];
	const ctx = { agentId, userId, source, runRef };
	const nudgeDue = endOfRun || (userTurns != null && shouldNudge(userTurns, settings.nudge_every_turns));
	return {
		enabled: true,
		settings,
		block: section.block,
		memoryIds: section.memoryIds || [],
		nudge: nudgeDue ? memoryNudge() : null,
		toolNames,
		schemas: learningToolSchemas(toolNames),
		handlers: learningToolHandlers(ctx, toolNames),
	};
}

/**
 * Tool calls, in order, from a run's persisted steps, in the shape the skill
 * drafter reads. The learning tools themselves are left out: saving memories
 * is not the procedure a skill should capture.
 *
 * @param {Array<{kind:string, tool_name?:string, tool?:string, input?:any, output?:any}>} steps
 */
export function toolCallsFromSteps(steps) {
	const calls = [];
	const open = new Map();
	for (const s of steps || []) {
		const tool = s.tool_name ?? s.tool;
		if (!tool || isLearningTool(tool)) continue;
		if (s.kind === 'tool_call') {
			const call = { tool, args: s.input ?? {} };
			calls.push(call);
			open.set(tool, [...(open.get(tool) || []), call]);
		} else if (s.kind === 'tool_blocked') {
			calls.push({ tool, args: s.input ?? {}, blocked: true });
		} else if (s.kind === 'tool_result') {
			const queue = open.get(tool) || [];
			const call = queue.shift();
			if (!call) continue;
			const out = s.output;
			if (out && typeof out === 'object' && out.error && Object.keys(out).length === 1) call.error = String(out.error);
			else call.result = out;
		}
	}
	return calls;
}

/**
 * Draft a skill from a finished run. Never throws: a failure here must not
 * touch a run whose answer is already delivered.
 */
export async function afterRunCompleted({ agentId, userId, runRef, goal, steps, finalAnswer, complete }) {
	try {
		return await draftSkillFromRun({
			agentId,
			userId,
			runRef,
			goal,
			toolCalls: toolCallsFromSteps(steps),
			finalAnswer,
			...(complete ? { complete } : {}),
		});
	} catch (err) {
		console.warn('[agent-learning] skill draft failed', err?.message);
		return { status: 'failed', reason: 'error' };
	}
}
