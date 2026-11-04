// Run replay and trajectory export for recorded agent runs.
//
// Replay has two modes, both over a run the owner already has in agent_runs and
// agent_run_steps:
//
//   buildReplay      deterministic. Rebuilds the run from its recorded steps:
//                    every tool call in order with the recorded result beside
//                    it, the receipt chain recomputed, and a signature over the
//                    ordered (tool, arguments) sequence. Nothing is executed and
//                    no model is called, so the same run always replays to the
//                    same bytes.
//   rerunPreview     re-executes the run's goal on a pinned model in preview-only
//                    mode (api/_lib/evals/execute.js): read-only tools run, every
//                    tool with a side effect answers with a preview and nothing
//                    moves. The result is compared with the recorded sequence.
//
// buildTrajectory turns a run into JSONL for analysis and training. Secrets,
// memory recalls and wallet key material are redacted before a line is written.

import { createHash } from 'node:crypto';
import { toolTraces, verifyReceiptChain, canonicalJson } from '../agents-v1/run-receipts.js';
import { scrubSecrets } from '../scrub-secrets.js';
import { AGENT_TOOLS } from '../agent-tools.js';
import { evalRung } from './models.js';
import { executeConversation, systemMessages } from './execute.js';

export const REPLAY_SCHEMA = 'three-ws/run-replay@1';
export const TRAJECTORY_SCHEMA = 'three-ws/trajectory@1';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/** The ordered (tool, arguments) sequence of a run's tool calls. */
export function toolSequence(steps) {
	return steps.filter((s) => s.kind === 'tool_call').map((s) => ({ tool: s.tool, input: s.input ?? {} }));
}

/** A digest of a tool sequence: equal digests mean the same calls in the same order. */
export function sequenceSignature(sequence) {
	return sha256(canonicalJson(sequence.map((c) => ({ tool: c.tool, input: c.input ?? {} }))));
}

function finalText(steps) {
	for (let i = steps.length - 1; i >= 0; i--) {
		const s = steps[i];
		if (s.kind === 'model_call' && s.output && !(s.output.toolCalls || []).length && s.output.content) return s.output.content;
	}
	return '';
}

/**
 * Deterministic replay of a recorded run.
 * @param {object} run    serializeRun(row)
 * @param {object[]} steps serializeStep(row)[], seq ascending
 */
export function buildReplay(run, steps) {
	const traces = toolTraces(steps);
	const sequence = toolSequence(steps);
	return {
		schema: REPLAY_SCHEMA,
		runId: run.id,
		agentId: run.agentId,
		goal: run.goal,
		status: run.status,
		model: run.model,
		receiptChain: verifyReceiptChain(run.id, steps),
		modelTurns: steps.filter((s) => s.kind === 'model_call').length,
		answer: run.result || finalText(steps),
		calls: traces.map((t, i) => ({
			index: i,
			tool: t.tool,
			input: t.input ?? {},
			status: t.status,
			output: t.output,
			callSeq: t.callSeq,
			resultSeq: t.resultSeq,
		})),
		signature: sequenceSignature(sequence),
	};
}

/**
 * Re-execute a run's goal on `model` with side effects previewed, then compare
 * the new tool sequence with the recorded one.
 *
 * @param {object} o
 * @param {object} o.run      serializeRun(row)
 * @param {object[]} o.steps  the run's recorded steps
 * @param {string} o.systemPrompt the agent's system prompt at the time of the replay
 * @param {string} o.model    a catalog model id (evalRung)
 * @param {object} [o.rung]   an already-resolved rung (tests inject one)
 */
export async function rerunPreview({ run, steps, systemPrompt, model, rung = evalRung(model), deadlineMs }) {
	const allowed = (Array.isArray(run.toolsAllowed) ? run.toolsAllowed : Object.keys(AGENT_TOOLS)).filter((t) => AGENT_TOOLS[t]);
	const messages = [...systemMessages(systemPrompt), { role: 'user', content: run.goal }];
	const trace = await executeConversation({
		messages,
		rung,
		allowed,
		previewOnly: true,
		temperature: run.temperature ?? 0.2,
		deadlineMs,
	});
	const recorded = toolSequence(steps);
	const replayed = trace.toolCalls.map((c) => ({ tool: c.tool, input: c.args ?? {} }));
	return {
		schema: REPLAY_SCHEMA,
		mode: 'preview',
		runId: run.id,
		model,
		status: trace.status,
		error: trace.error,
		answer: trace.answer,
		executed: trace.toolCalls.filter((c) => !c.sandboxed && !c.blocked).map((c) => c.tool),
		blocked: trace.toolCalls.filter((c) => c.blocked).map((c) => ({ tool: c.tool, reason: c.reason })),
		toolCalls: trace.toolCalls,
		tokens: trace.tokens,
		costUsd: trace.costUsd,
		latencyMs: trace.latencyMs,
		recorded: { signature: sequenceSignature(recorded), tools: recorded.map((c) => c.tool) },
		replayed: { signature: sequenceSignature(replayed), tools: replayed.map((c) => c.tool) },
		sameSequence: sequenceSignature(recorded) === sequenceSignature(replayed),
	};
}

// ── trajectory export ────────────────────────────────────────────────────────

const MEMORY_TOOL = /memor|recall|remember|journal|diary/i;
const REDACTED = '[redacted]';

// Value patterns that are secrets wherever they appear in free text.
const SECRET_VALUES = [
	/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
	/\bsk_(?:live|test)_[A-Za-z0-9]{8,}/g,
	/\bsk-[A-Za-z0-9_-]{16,}/g,
	/\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{16,}/g,
	/\bAIza[0-9A-Za-z_-]{30,}/g,
	/\bxox[abpr]-[A-Za-z0-9-]{10,}/g,
	/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
	// A base58 string of secret-key length (a 64-byte Solana keypair is 87-88 chars).
	/\b[1-9A-HJ-NP-Za-km-z]{86,90}\b/g,
];

/** Redact secret-looking substrings from free text. */
export function redactText(text) {
	let out = String(text);
	for (const re of SECRET_VALUES) out = out.replace(re, REDACTED);
	return out;
}

/** Deep-redact a JSON value: secret-named keys by scrubSecrets, secret-looking strings by value. */
export function redactValue(value) {
	const walk = (v) => {
		if (typeof v === 'string') return redactText(v);
		if (Array.isArray(v)) return v.map(walk);
		if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
		return v;
	};
	return walk(scrubSecrets(value));
}

/**
 * The JSONL lines of a run: one header, then one line per step. Memory recalls
 * (a tool whose name reads as memory) keep their call and drop their result,
 * because a recalled memory is the owner's private data.
 *
 * @returns {string[]} lines without the trailing newline
 */
export function buildTrajectory(run, steps) {
	const lines = [
		{
			type: 'run',
			schema: TRAJECTORY_SCHEMA,
			runId: run.id,
			agentId: run.agentId,
			goal: redactText(run.goal || ''),
			status: run.status,
			model: run.model,
			temperature: run.temperature,
			toolsAllowed: run.toolsAllowed,
			steps: steps.length,
			createdAt: run.createdAt,
			finishedAt: run.finishedAt,
			result: run.result == null ? null : redactText(run.result),
			redaction: { secrets: true, memories: true },
		},
	];
	for (const s of steps) {
		const memory = s.tool && MEMORY_TOOL.test(s.tool);
		const isResult = s.kind === 'tool_result';
		lines.push({
			type: 'step',
			seq: s.seq,
			kind: s.kind,
			tool: s.tool,
			provider: s.provider,
			model: s.model,
			input: s.input == null ? null : redactValue(s.input),
			output: memory && isResult ? { redacted: 'memory' } : s.output == null ? null : redactValue(s.output),
			usage: s.usage,
			costUsd: s.costUsd,
			latencyMs: s.latencyMs,
			receipt: s.receipt,
			at: s.at,
		});
	}
	return lines.map((l) => JSON.stringify(l));
}
