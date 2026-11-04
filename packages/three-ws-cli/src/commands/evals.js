// Agent evals from the terminal. Every sub-command honors --json and exits with
// the stable table in src/automation.js; a run that fails any task exits 1 so a
// script or CI job can gate on it.
//
//   three-ws evals list --agent <id|name> [--suite smoke]    score history, newest first
//   three-ws evals run --agent <id|name> --suite <name> [--model <id>] [--out report.json]
//   three-ws evals show <eval-id> --agent <id|name> [--out report.json]
//
// Backed by GET/POST /api/v1/agents/:id/evals. The run streams per-task
// progress over server-sent events and only lanes that cost the platform
// nothing (free models and Vertex Gemini) can run through the API.

import fs from 'node:fs';
import path from 'node:path';
import { c, line, printJson, rows } from '../ui.js';
import { ApiError, USER_AGENT, requestJson } from '../http.js';
import { CliError, EXIT_CODES, requireInput } from '../automation.js';
import { authed, resolveAgent } from './automation.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RUN_TIMEOUT_MS = 290_000;

const pct = (n) => (n == null ? 'n/a' : `${Math.round(n * 100)}%`);
const usd = (n) => (n == null ? 'n/a' : `$${Number(n).toFixed(4)}`);

function writeReport(file, report) {
	const target = path.resolve(file);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
	process.stderr.write(`Wrote ${target}\n`);
}

/** Parse a text/event-stream body into { event, data } records as they arrive. */
export async function* readSse(body) {
	const decoder = new TextDecoder();
	let buf = '';
	for await (const chunk of body) {
		buf += decoder.decode(chunk, { stream: true });
		let i;
		while ((i = buf.indexOf('\n\n')) !== -1) {
			const block = buf.slice(0, i);
			buf = buf.slice(i + 2);
			let event = 'message';
			const data = [];
			for (const l of block.split('\n')) {
				if (l.startsWith('event:')) event = l.slice(6).trim();
				else if (l.startsWith('data:')) data.push(l.slice(5).trimStart());
			}
			if (data.length) yield { event, data: JSON.parse(data.join('\n')) };
		}
	}
}

async function apiFailure(res) {
	const text = await res.text();
	let body = null;
	try { body = JSON.parse(text); } catch { body = null; }
	const code = body?.error?.code || null;
	return new ApiError(`${res.status} ${code ? `${code}: ` : ''}${body?.error?.message || text.slice(0, 200) || res.statusText}`, { status: res.status, code, body });
}

function printReport(report) {
	const s = report.summary;
	line(`${c.bold(report.suite.title)} on ${report.config.label} ${c.dim(`(${report.model}, config ${report.config.version})`)}`);
	rows([
		['Score', s.score == null ? 'n/a' : s.score.toFixed(2)],
		['Passed', `${s.passed}/${s.tasks} (${pct(s.passRate)})`],
		['Failed', String(s.failed)],
		['Errored', String(s.errored)],
		['Cost', usd(s.costUsd)],
		['Avg steps', s.avgSteps == null ? 'n/a' : String(s.avgSteps)],
	], '  ');
	if (report.truncated) line(c.dim(`  Stopped early at the cost cap (${usd(report.truncated.maxCostUsd)}): ${report.truncated.skipped.length} task(s) not run.`));
}

export async function evals(ctx) {
	const [sub = 'list', arg] = ctx.positionals;
	const headers = await authed(ctx);
	const agent = await resolveAgent(ctx, headers, ctx.flags.agent);
	const base = `${ctx.origin}/api/v1/agents/${agent.id}/evals`;

	if (sub === 'list') {
		const q = ctx.flags.suite ? `?suite=${encodeURIComponent(ctx.flags.suite)}` : '';
		const { data } = await requestJson(`${base}${q}`, { headers });
		if (ctx.flags.json) printJson({ agent: agent.id, evals: data });
		else if (!data.length) line(`${agent.name || agent.id} has no evals yet. Run one: three-ws evals run --agent ${agent.id} --suite smoke`);
		else {
			for (const e of data) {
				line(`${e.id}  ${String(e.suite).padEnd(10)} ${String(e.status).padEnd(10)} score ${e.score == null ? 'n/a ' : e.score.toFixed(2)}  ${e.model}  ${c.dim(String(e.createdAt).slice(0, 16))}`);
			}
		}
		return EXIT_CODES.OK;
	}

	if (sub === 'show') {
		requireInput(arg, 'an eval id', 'usage: three-ws evals show <eval-id> --agent <id|name>');
		if (!UUID_RE.test(arg)) throw new CliError(EXIT_CODES.USAGE, 'invalid_eval_id', 'an eval id is a uuid. List them with `three-ws evals list --agent <id>`.');
		const { data } = await requestJson(`${base}/${arg}`, { headers });
		if (ctx.flags.out && data.report) writeReport(ctx.flags.out, data.report);
		if (ctx.flags.json) printJson(data);
		else if (data.report) {
			printReport(data.report);
			for (const t of data.report.tasks) line(`  ${t.status === 'passed' ? c.green('pass') : t.status === 'failed' ? c.red('FAIL') : c.dim('err ')}  ${t.id}  ${c.dim(`${t.trace.steps} steps`)}`);
		} else line(`Eval ${data.id} is ${data.status}${data.error ? `: ${data.error}` : ''}.`);
		return EXIT_CODES.OK;
	}

	if (sub === 'run') {
		requireInput(ctx.flags.suite, 'a suite', 'usage: three-ws evals run --agent <id|name> --suite <name> [--model <id>]');
		const res = await fetch(base, {
			method: 'POST',
			headers: { ...headers, 'user-agent': USER_AGENT, accept: 'text/event-stream', 'content-type': 'application/json' },
			body: JSON.stringify({ suite: ctx.flags.suite, ...(ctx.flags.model ? { model: ctx.flags.model } : {}) }),
			signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
		}).catch((err) => {
			throw new ApiError(`could not reach ${new URL(ctx.origin).host}: ${err?.cause?.code || err?.message || 'network error'}`);
		});
		if (!res.ok) throw await apiFailure(res);

		const quiet = Boolean(ctx.flags.json);
		let report = null;
		let record = null;
		for await (const { event, data } of readSse(res.body)) {
			if (event === 'start' && !quiet) line(`Running ${data.suite} (${data.tasks} tasks) on ${data.model}...`);
			if (event === 'task' && !quiet) {
				const mark = data.status === 'passed' ? c.green('pass') : data.status === 'failed' ? c.red('FAIL') : c.dim('err ');
				line(`  [${data.index + 1}/${data.total}] ${mark}  ${data.id}  ${c.dim(`${data.steps} steps, ${data.latencyMs} ms`)}`);
				for (const f of data.failedChecks) line(`           - ${f}`);
				if (data.error) line(`           - ${data.error}`);
			}
			if (event === 'done') {
				report = data.report;
				record = data;
			}
			if (event === 'error') throw new CliError(EXIT_CODES.ERROR, data.code || 'eval_failed', data.message || 'the eval failed');
		}
		if (!report) throw new CliError(EXIT_CODES.NETWORK, 'eval_stream_ended', 'the connection closed before the eval finished. Check `three-ws evals list` for the result.');
		if (ctx.flags.out) writeReport(ctx.flags.out, report);
		if (quiet) printJson(record);
		else {
			line('');
			printReport(report);
		}
		return report.summary.failed > 0 || report.summary.errored > 0 ? EXIT_CODES.ERROR : EXIT_CODES.OK;
	}

	throw new CliError(EXIT_CODES.USAGE, 'usage', 'usage: three-ws evals <list|run --suite <name>|show <eval-id>> --agent <id|name>');
}
