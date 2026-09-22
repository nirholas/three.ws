// Run a suite, summarize it, compare two runs, and render a report.
//
// A report is the durable artifact of an eval: the suite and configuration it
// scored, the pinned model, every task's checks and full trace, and a summary.
// The CLI writes it to evals/reports/, the Evaluate tab stores it in
// agent_evals, and compareReports diffs any two of them task by task.

import { randomUUID } from 'node:crypto';
import { scoreTask } from './checks.js';
import { runTask } from './execute.js';
import { configSnapshot } from './configs.js';

export const REPORT_SCHEMA = 'three-ws/eval-report@1';

function round(n, digits = 4) {
	if (n == null || !Number.isFinite(n)) return null;
	const f = 10 ** digits;
	return Math.round(n * f) / f;
}

/** Score one task's trace into its report row. */
export function taskResult(task, trace) {
	if (trace.infra) {
		return {
			id: task.id,
			title: task.title,
			status: 'errored',
			score: null,
			checks: [],
			error: trace.error,
			trace,
		};
	}
	const scored = scoreTask(task, trace);
	return {
		id: task.id,
		title: task.title,
		status: scored.passed ? 'passed' : 'failed',
		score: round(scored.score),
		checks: scored.checks,
		error: trace.error,
		trace,
	};
}

/** Aggregate task rows into the report summary. */
export function summarize(tasks) {
	const scored = tasks.filter((t) => t.status !== 'errored');
	const sum = (xs) => xs.reduce((a, b) => a + b, 0);
	const costs = scored.map((t) => t.trace.costUsd);
	return {
		tasks: tasks.length,
		passed: tasks.filter((t) => t.status === 'passed').length,
		failed: tasks.filter((t) => t.status === 'failed').length,
		errored: tasks.length - scored.length,
		score: scored.length ? round(sum(scored.map((t) => t.score)) / scored.length) : null,
		passRate: scored.length ? round(scored.filter((t) => t.status === 'passed').length / scored.length) : null,
		costUsd: costs.some((c) => c == null) ? null : round(sum(costs), 6),
		avgSteps: scored.length ? round(sum(scored.map((t) => t.trace.steps)) / scored.length, 2) : null,
		avgLatencyMs: scored.length ? Math.round(sum(scored.map((t) => t.trace.latencyMs)) / scored.length) : null,
		tokens: {
			input: sum(tasks.map((t) => t.trace.tokens?.input || 0)),
			output: sum(tasks.map((t) => t.trace.tokens?.output || 0)),
		},
	};
}

/**
 * Run every task in a suite against one configuration on one pinned rung.
 *
 * @param {object} suite
 * @param {object} config            from api/_lib/evals/configs.js
 * @param {object} o
 * @param {object} o.rung            from evalRung(model)
 * @param {string} o.model           the model id the rung serves
 * @param {string} [o.target]        where it ran: 'local' or an origin
 * @param {string[]} [o.only]        run only these task ids
 * @param {(row: object, index: number, total: number) => void|Promise<void>} [o.onTask]
 */
export async function runSuite(suite, config, { rung, model, target = 'local', only, onTask, deadlineMs } = {}) {
	const tasks = only?.length ? suite.tasks.filter((t) => only.includes(t.id)) : suite.tasks;
	if (!tasks.length) throw new Error(`No task in suite "${suite.name}" matches ${only.join(', ')}`);
	const startedAt = new Date();
	const rows = [];
	for (const [i, task] of tasks.entries()) {
		const trace = await runTask(task, config, { rung, suiteDefaults: suite.defaults || {}, deadlineMs });
		const row = taskResult(task, trace);
		rows.push(row);
		if (onTask) await onTask(row, i, tasks.length);
	}
	const finishedAt = new Date();
	return {
		schema: REPORT_SCHEMA,
		id: randomUUID(),
		suite: { name: suite.name, version: suite.version, title: suite.title || suite.name },
		config: configSnapshot(config),
		model,
		provider: rung.name,
		target,
		startedAt: startedAt.toISOString(),
		finishedAt: finishedAt.toISOString(),
		durationMs: finishedAt - startedAt,
		summary: summarize(rows),
		tasks: rows,
	};
}

function delta(a, b) {
	return a == null || b == null ? null : round(b - a, 6);
}

/**
 * Diff two reports task by task. `a` is the baseline, `b` the candidate.
 * Reports of different suites cannot be compared; different suite versions can,
 * with a warning, because a task edit changes what a score means.
 */
export function compareReports(a, b) {
	if (a?.schema !== REPORT_SCHEMA || b?.schema !== REPORT_SCHEMA) throw new Error('Both inputs must be eval reports.');
	if (a.suite.name !== b.suite.name) throw new Error(`Cannot compare suite "${a.suite.name}" with suite "${b.suite.name}".`);
	const warnings = [];
	if (a.suite.version !== b.suite.version) warnings.push(`Suite version differs (v${a.suite.version} vs v${b.suite.version}); task definitions may have changed.`);
	if (a.summary.errored || b.summary.errored) warnings.push('One side has errored tasks; those are excluded from its score.');

	const byId = new Map(a.tasks.map((t) => [t.id, t]));
	const tasks = [];
	for (const tb of b.tasks) {
		const ta = byId.get(tb.id);
		byId.delete(tb.id);
		const change = !ta
			? 'added'
			: ta.status === tb.status
				? ta.score === tb.score
					? 'unchanged'
					: tb.score > ta.score
						? 'improved'
						: 'regressed'
				: tb.status === 'passed' || (ta.status === 'errored' && tb.status !== 'errored')
					? 'improved'
					: 'regressed';
		tasks.push({
			id: tb.id,
			title: tb.title,
			change,
			before: ta ? { status: ta.status, score: ta.score, steps: ta.trace.steps, costUsd: ta.trace.costUsd, tools: ta.trace.toolCalls.map((c) => c.tool) } : null,
			after: { status: tb.status, score: tb.score, steps: tb.trace.steps, costUsd: tb.trace.costUsd, tools: tb.trace.toolCalls.map((c) => c.tool) },
			failedChecks: tb.checks.filter((c) => !c.passed).map((c) => c.detail),
		});
	}
	for (const ta of byId.values()) {
		tasks.push({ id: ta.id, title: ta.title, change: 'removed', before: { status: ta.status, score: ta.score }, after: null, failedChecks: [] });
	}
	const count = (k) => tasks.filter((t) => t.change === k).length;
	return {
		suite: b.suite,
		baseline: { id: a.id, model: a.model, config: a.config.version, label: a.config.label, finishedAt: a.finishedAt, summary: a.summary },
		candidate: { id: b.id, model: b.model, config: b.config.version, label: b.config.label, finishedAt: b.finishedAt, summary: b.summary },
		delta: {
			score: delta(a.summary.score, b.summary.score),
			passRate: delta(a.summary.passRate, b.summary.passRate),
			costUsd: delta(a.summary.costUsd, b.summary.costUsd),
			avgSteps: delta(a.summary.avgSteps, b.summary.avgSteps),
			avgLatencyMs: delta(a.summary.avgLatencyMs, b.summary.avgLatencyMs),
		},
		counts: { improved: count('improved'), regressed: count('regressed'), unchanged: count('unchanged'), added: count('added'), removed: count('removed') },
		warnings,
		tasks,
	};
}

const pct = (v) => (v == null ? 'n/a' : `${(v * 100).toFixed(1)}%`);
const usd = (v) => (v == null ? 'unpriced' : `$${v.toFixed(6)}`);
const signed = (v, fmt) => (v == null ? 'n/a' : `${v > 0 ? '+' : ''}${fmt(v)}`);

/** A human-readable Markdown rendering of one report. */
export function renderReportMarkdown(r) {
	const s = r.summary;
	const lines = [
		`# ${r.suite.title} on ${r.config.label}`,
		'',
		`Model \`${r.model}\` (${r.provider}), configuration \`${r.config.version}\`, suite v${r.suite.version}, ran ${r.finishedAt} (${r.target}).`,
		'',
		`| Score | Passed | Failed | Errored | Cost | Avg steps | Avg latency |`,
		`|---|---|---|---|---|---|---|`,
		`| ${pct(s.score)} | ${s.passed}/${s.tasks} | ${s.failed} | ${s.errored} | ${usd(s.costUsd)} | ${s.avgSteps ?? 'n/a'} | ${s.avgLatencyMs ?? 'n/a'} ms |`,
		'',
		'| Task | Result | Score | Steps | Tools | Notes |',
		'|---|---|---|---|---|---|',
	];
	for (const t of r.tasks) {
		const notes = t.status === 'errored' ? t.error : t.checks.filter((c) => !c.passed).map((c) => c.detail).join('; ');
		const tools = t.trace.toolCalls.map((c) => `${c.tool}${c.sandboxed ? ' (preview)' : ''}${c.blocked ? ' (blocked)' : ''}`).join(', ');
		lines.push(`| ${t.title} | ${t.status} | ${t.score == null ? 'n/a' : pct(t.score)} | ${t.trace.steps} | ${tools || 'none'} | ${(notes || '').replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`);
	}
	return `${lines.join('\n')}\n`;
}

/** A human-readable Markdown rendering of a comparison. */
export function renderComparisonMarkdown(c) {
	const lines = [
		`# ${c.suite.title}: ${c.baseline.label} \`${c.baseline.model}\` vs ${c.candidate.label} \`${c.candidate.model}\``,
		'',
		...c.warnings.map((w) => `> ${w}`),
		...(c.warnings.length ? [''] : []),
		'| | Baseline | Candidate | Change |',
		'|---|---|---|---|',
		`| Score | ${pct(c.baseline.summary.score)} | ${pct(c.candidate.summary.score)} | ${signed(c.delta.score, (v) => `${(v * 100).toFixed(1)} pts`)} |`,
		`| Pass rate | ${pct(c.baseline.summary.passRate)} | ${pct(c.candidate.summary.passRate)} | ${signed(c.delta.passRate, (v) => `${(v * 100).toFixed(1)} pts`)} |`,
		`| Cost | ${usd(c.baseline.summary.costUsd)} | ${usd(c.candidate.summary.costUsd)} | ${signed(c.delta.costUsd, (v) => `$${v.toFixed(6)}`)} |`,
		`| Avg steps | ${c.baseline.summary.avgSteps ?? 'n/a'} | ${c.candidate.summary.avgSteps ?? 'n/a'} | ${signed(c.delta.avgSteps, (v) => v.toFixed(2))} |`,
		`| Avg latency | ${c.baseline.summary.avgLatencyMs ?? 'n/a'} ms | ${c.candidate.summary.avgLatencyMs ?? 'n/a'} ms | ${signed(c.delta.avgLatencyMs, (v) => `${v} ms`)} |`,
		'',
		`${c.counts.improved} improved, ${c.counts.regressed} regressed, ${c.counts.unchanged} unchanged${c.counts.added ? `, ${c.counts.added} added` : ''}${c.counts.removed ? `, ${c.counts.removed} removed` : ''}.`,
		'',
		'| Task | Change | Before | After | Tools after | Failing checks |',
		'|---|---|---|---|---|---|',
	];
	for (const t of c.tasks) {
		const b = t.before ? `${t.before.status}${t.before.score == null ? '' : ` ${pct(t.before.score)}`}` : 'n/a';
		const a = t.after ? `${t.after.status}${t.after.score == null ? '' : ` ${pct(t.after.score)}`}` : 'n/a';
		lines.push(`| ${t.title} | ${t.change} | ${b} | ${a} | ${(t.after?.tools || []).join(', ') || 'none'} | ${t.failedChecks.join('; ').replace(/\|/g, '\\|') || ''} |`);
	}
	return `${lines.join('\n')}\n`;
}
