// Run receipts and summaries: the audit layer over agent_run_steps.
//
// Every step a run writes carries a receipt, a sha256 digest chained to the
// step before it (migration 20261010163000_agent_run_receipts.sql). Anyone
// holding the step rows can recompute the chain with verifyReceiptChain and
// prove that no tool call or tool result was edited, dropped or reordered.
//
// JSON is hashed in canonical form (object keys sorted at every depth) because
// jsonb does not preserve key order: the bytes we hash at insert time must be
// reproducible from what the database hands back later.

import { createHash } from 'node:crypto';

/** JSON with object keys sorted at every depth; null for undefined. */
export function canonicalJson(value) {
	if (value === undefined || value === null) return 'null';
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (typeof value === 'object') {
		const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
		return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
	}
	return JSON.stringify(value);
}

/**
 * The receipt for one step, chained to the receipt of the step before it.
 * @param {{ prev: string|null, runId: string, seq: number, kind: string, tool?: string|null, input?: unknown, output?: unknown }} s
 */
export function stepReceipt({ prev, runId, seq, kind, tool = null, input = null, output = null }) {
	return createHash('sha256')
		.update([prev || '', runId, String(seq), kind, tool || '', canonicalJson(input), canonicalJson(output)].join('|'))
		.digest('hex');
}

/**
 * Recompute a run's receipt chain from its serialized steps (seq ascending).
 * Steps written before receipts existed (receipt null) are skipped until the
 * chain starts. Returns { verified, checked, brokenAt }.
 */
export function verifyReceiptChain(runId, steps) {
	let prev = null;
	let checked = 0;
	for (const s of steps) {
		if (!s.receipt) {
			if (checked) return { verified: false, checked, brokenAt: s.seq };
			continue;
		}
		const expected = stepReceipt({ prev, runId, seq: s.seq, kind: s.kind, tool: s.tool, input: s.input, output: s.output });
		if (expected !== s.receipt) return { verified: false, checked, brokenAt: s.seq };
		prev = s.receipt;
		checked += 1;
	}
	return { verified: checked > 0, checked, brokenAt: null };
}

/**
 * Pair every tool call with its result (or its block) into one trace entry,
 * in call order. The receipt on each entry is the result's receipt, which
 * chains over the call before it, so one digest vouches for both halves.
 */
export function toolTraces(steps) {
	const traces = [];
	const open = [];
	for (const s of steps) {
		if (s.kind === 'tool_call') {
			const t = { tool: s.tool, input: s.input, callSeq: s.seq, callReceipt: s.receipt ?? null, status: 'pending', output: null, resultSeq: null, receipt: s.receipt ?? null, latencyMs: null, at: s.at };
			traces.push(t);
			open.push(t);
		} else if (s.kind === 'tool_result' || s.kind === 'tool_blocked') {
			const i = open.findIndex((t) => t.tool === s.tool);
			const t = i >= 0 ? open.splice(i, 1)[0] : { tool: s.tool, input: s.input, callSeq: null, callReceipt: null, at: s.at };
			if (i < 0) traces.push(t);
			const failed = s.kind === 'tool_result' && s.output && typeof s.output === 'object' && 'error' in s.output && Object.keys(s.output).length === 1;
			t.status = s.kind === 'tool_blocked' ? 'blocked' : failed ? 'error' : 'ok';
			t.output = s.output;
			t.resultSeq = s.seq;
			t.receipt = s.receipt ?? null;
			t.latencyMs = s.latencyMs ?? null;
		}
	}
	return traces;
}

const STATUS_LEAD = {
	completed: 'Completed',
	failed: 'Failed',
	cancelled: 'Cancelled',
	budget_exhausted: 'Stopped at its budget',
};

function money(n) {
	const v = Number(n) || 0;
	return v === 0 ? '$0' : v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
}

function duration(ms) {
	if (!Number.isFinite(ms) || ms < 0) return null;
	const s = Math.round(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${s % 60}s`;
	return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function excerpt(text, n = 280) {
	const t = String(text || '').replace(/\s+/g, ' ').trim();
	return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/**
 * A plain-language account of how a run ended.
 * @param {object} run   the agent_runs row after finalize
 * @param {Array<{ kind: string, tool_name: string|null, n: number, failed: number }>} tally  step counts by kind and tool
 */
export function summarizeRun(run, tally) {
	const lead = STATUS_LEAD[run.status] || run.status;
	const turns = tally.filter((t) => t.kind === 'model_call').reduce((a, t) => a + Number(t.n), 0);
	const byTool = new Map();
	let failedCalls = 0;
	let blocked = 0;
	for (const t of tally) {
		if (t.kind === 'tool_call' && t.tool_name) byTool.set(t.tool_name, (byTool.get(t.tool_name) || 0) + Number(t.n));
		if (t.kind === 'tool_result') failedCalls += Number(t.failed || 0);
		if (t.kind === 'tool_blocked') blocked += Number(t.n);
	}
	const started = run.started_at || run.created_at;
	const took = started && run.finished_at ? duration(new Date(run.finished_at) - new Date(started)) : null;

	const parts = [];
	parts.push(`${lead} after ${turns} model turn${turns === 1 ? '' : 's'}${took ? ` in ${took}` : ''}.`);
	const calls = [...byTool.values()].reduce((a, n) => a + n, 0);
	if (calls) {
		const list = [...byTool.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => (n > 1 ? `${name} x${n}` : name)).join(', ');
		const extra = [failedCalls ? `${failedCalls} failed` : null, blocked ? `${blocked} blocked` : null].filter(Boolean).join(', ');
		parts.push(`Made ${calls} tool call${calls === 1 ? '' : 's'}: ${list}${extra ? ` (${extra})` : ''}.`);
	} else {
		parts.push('Made no tool calls.');
	}
	const budget = Number(run.budget_credits_usd) || 0;
	const spent = Number(run.spent_credits_usd) || 0;
	parts.push(budget > 0 ? `Spent ${money(spent)} of a ${money(budget)} budget.` : 'Ran on free model lanes only, with no credit spend.');
	if (run.status === 'completed' && run.result) parts.push(`Result: ${excerpt(run.result)}`);
	else if (run.error) parts.push(`Reason: ${excerpt(run.error)}`);
	return parts.join(' ');
}
