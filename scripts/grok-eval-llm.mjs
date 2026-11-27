#!/usr/bin/env node
// LLM eval: does Grok beat the model production serves today on the five
// highest-traffic LLM tasks whose output a person reads, by enough to route
// traffic to it?
//
// For every row of data/evals/llm-<task>.jsonl and every lane asked for, this
// builds the exact request production sends (scripts/lib/llm-eval/tasks.js:
// system prompt, user turn, tools and token budget imported from the production
// modules), sends it to that lane's one fixed model (scripts/lib/llm-eval/lanes.js),
// grades the reply with the objective grader that mirrors production's own
// post-processing (graders.js), and records latency and cost. Once a Grok lane
// and the current lane both have a row, a third model judges the pair blind,
// twice with positions swapped (judge.js). The report (report.js) is rebuilt
// from the saved results every run.
//
//   npm run grok:eval-llm -- --prod-env                            current lane, all 250 rows
//   GROK_API_KEY="$(cat <key file>)" npm run grok:eval-llm -- --prod-env --lanes grok,grok_budget
//                                                                  add the Grok columns
//   npm run grok:eval-llm -- --prod-env --tasks x_reply --only x-07,x-12 --force
//   npm run grok:eval-llm -- --report                              rebuild the doc only
//
// --lanes         current,grok,grok_budget subset (default current)
// --tasks         task subset (default all five)
// --only          comma-separated row ids
// --limit N       first N rows per task after --only filtering
// --concurrency N calls in flight per lane (1 to 8, default 4)
// --force         rerun finished rows; --retry-failed reruns rows that errored
// --no-judge      skip the pairwise judge
// --report        do not call any model, rebuild the report from saved results
// --regrade       do not call any model, re-grade every saved reply with the
//                 current graders (after a grader fix), then rebuild the report
// --prod-env      read the current lane's and the judges' keys from the
//                 three-ws-api Cloud Run service into this process only.
//                 DATABASE_URL is loaded only when a Grok lane runs with a key,
//                 so Grok spend lands in the xAI credit ledger (lane `eval`);
//                 no other table is written.
//
// The Grok lanes need GROK_API_KEY (or XAI_API_KEY) in the environment of the
// process running the eval, and nowhere else: the eval never needs a key on the
// production service. A key set in the shell always wins; --prod-env does not
// read the service's copy of a key the shell already holds. Without --prod-env
// the Grok lanes still run and are graded; their judge pairs and ledger rows
// wait in the results file and the next --prod-env run settles both without
// calling xAI again.
//
// A Grok lane run with no key in the environment sends one real request without
// a key and records xAI's answer (the documented 401) instead of running the
// set, so the report states exactly what is missing.
//
// Results (resumable, last line for a key wins):
//   data/evals/llm-results/results.jsonl  one line per lane:task:id
//     { task, id, lane, model, ok, status, error, latencyMs, attempts, costMicro,
//       usage, text, toolCalls, pass, checks, reason, shipped, advisory, at }
//     latencyMs, usage and costMicro belong to the attempt that settled the row.
//     Grok rows also carry { responseId, ledgered }: xAI's response id and
//     whether the call has reached the xAI credit ledger yet.
//   data/evals/llm-results/judged.jsonl   one line per task:id:lane pair
//     { task, id, a: 'current', b, judge, score (b vs a: 1 win, 0.5 tie, 0 loss), verdicts, consistent, at }
//   data/evals/llm-results/runs.json      { runs: [...], keyProbe: { status, error, at } | null }
//     A run that retried anything carries unanswered: { <lane>: { <kind>: n } },
//     the attempts that timed out, were rate limited or hit a server error.
// Report: docs/evals/grok-4-7-on-three-ws.md
//
// Exit codes: 0 ok; 1 every call in a lane that ran failed; 2 usage or setup error.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, renameSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCloudRunEnv } from './lib/cloud-run-env.mjs';
import { TASKS, TASK_INFO, buildRequest, judgeInput } from './lib/llm-eval/tasks.js';
import { LANES, laneKey, callLane, CALL_LIMIT_MS } from './lib/llm-eval/lanes.js';
import { normalizeXaiUsage } from '../api/_lib/xai-usage.js';
import { priceTableCostMicro } from '../api/_lib/xai-pricing.js';
import { grade } from './lib/llm-eval/graders.js';
import { JUDGES, pickJudge, judgePair } from './lib/llm-eval/judge.js';
import { buildReport, laneSummary } from './lib/llm-eval/report.js';
import { unledgered, ledgerInput } from './lib/llm-eval/ledger.js';
import { attemptKind, tallyUnanswered } from './lib/llm-eval/attempts.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'data/evals/llm-results');
const RESULTS_FILE = join(OUT_DIR, 'results.jsonl');
const JUDGED_FILE = join(OUT_DIR, 'judged.jsonl');
const RUNS_FILE = join(OUT_DIR, 'runs.json');
const REPORT_FILE = join(ROOT, 'docs/evals/grok-4-7-on-three-ws.md');

// Only the model keys the lanes and judges read. DATABASE_URL rides along for
// the xAI ledger and is dropped again unless a keyed Grok lane runs.
const ENV_WANTED = /^(NVIDIA_API_KEY|GROK_API_KEY|XAI_API_KEY|GROQ_API_KEY|OPENROUTER_API_KEY|DATABASE_URL)$/;
// The xAI key under both of its names. One set in the shell is the operator's
// own and is never replaced by, or mixed with, the service's.
const XAI_KEY_ENVS = ['GROK_API_KEY', 'XAI_API_KEY'];
const MAX_ATTEMPTS = 4;
const MAX_WAIT_S = 120;

// What production served for these tasks, measured from usage_events before
// the run (2026-11-20). Stated in the report so the lane choice is auditable.
const PRODUCTION_NOTE =
	'Production runs each task through a free-first fallback ladder, so no single model owns all of it. Over the 3 days before the run (usage_events, 2026-11-20) NVIDIA Nemotron 3 Ultra served the most calls on every task: 549 of 1,067 forge director calls (423 on the NIM endpoint itself, p50 4,487 ms and p95 6,118 ms on the leading rung), 20 of 23 X replies and 14 of 19 agent specs; over 7 days it served 382 of 683 agent chat turns. The current lane is that model on the NIM endpoint with the request flags production sends. Measuring the ladder itself would score whichever rung was free that minute.';

function usage(msg) {
	if (msg) console.error(`grok-eval-llm: ${msg}`);
	console.error('Usage: npm run grok:eval-llm -- [--prod-env] [--lanes current,grok,grok_budget] [--tasks a,b] [--only ids] [--limit N] [--concurrency N] [--force] [--retry-failed] [--no-judge] [--report] [--regrade]');
	process.exit(2);
}

function parseArgs(argv) {
	const out = { prodEnv: false, lanes: ['current'], tasks: [...TASKS], only: null, limit: null, concurrency: 4, force: false, retryFailed: false, judge: true, report: false, regrade: false };
	const list = (v, name) => {
		if (!v || v.startsWith('--')) usage(`${name} needs a value`);
		return v.split(',').map((s) => s.trim()).filter(Boolean);
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--prod-env') out.prodEnv = true;
		else if (a === '--lanes') out.lanes = list(argv[++i], a);
		else if (a === '--tasks') out.tasks = list(argv[++i], a);
		else if (a === '--only') out.only = new Set(list(argv[++i], a));
		else if (a === '--limit') out.limit = Number(argv[++i]);
		else if (a === '--concurrency') out.concurrency = Number(argv[++i]);
		else if (a === '--force') out.force = true;
		else if (a === '--retry-failed') out.retryFailed = true;
		else if (a === '--no-judge') out.judge = false;
		else if (a === '--report') out.report = true;
		else if (a === '--regrade') out.regrade = true;
		else if (a === '--help' || a === '-h') usage();
		else usage(`unknown flag ${a}`);
	}
	for (const l of out.lanes) if (!LANES[l]) usage(`unknown lane ${l} (expected ${Object.keys(LANES).join(', ')})`);
	for (const t of out.tasks) if (!TASKS.includes(t)) usage(`unknown task ${t} (expected ${TASKS.join(', ')})`);
	if (out.limit !== null && !(Number.isInteger(out.limit) && out.limit > 0)) usage('--limit must be a positive integer');
	if (!(Number.isInteger(out.concurrency) && out.concurrency >= 1 && out.concurrency <= 8)) usage('--concurrency must be 1 to 8');
	return out;
}

function loadSets() {
	return Object.fromEntries(
		TASKS.map((t) => {
			const file = join(ROOT, `data/evals/llm-${t}.jsonl`);
			const rows = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l, i) => {
				try {
					return JSON.parse(l);
				} catch (err) {
					throw new Error(`${relative(ROOT, file)} line ${i + 1}: ${err.message}`);
				}
			});
			return [t, rows];
		}),
	);
}

function readJsonl(file, keyOf) {
	const map = new Map();
	if (!existsSync(file)) return map;
	for (const line of readFileSync(file, 'utf8').split('\n')) {
		if (!line.trim()) continue;
		const r = JSON.parse(line);
		map.set(keyOf(r), r);
	}
	return map;
}

// One JSONL line. Model output is kept verbatim, but dash glyphs are written as
// JSON \u escapes so the committed files carry none (house rule); parsing the
// line gives back the exact text.
const jsonLine = (r) => JSON.stringify(r).replace(/[\u2013\u2014]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`);

// Rewrite a JSONL file from its map, deduplicated and in a stable order, so the
// committed file only changes where results did.
function compactJsonl(file, map) {
	const lines = [...map.values()]
		.sort((x, y) => `${x.task}:${x.lane ?? x.b}:${x.id}`.localeCompare(`${y.task}:${y.lane ?? y.b}:${y.id}`))
		.map(jsonLine);
	const tmp = `${file}.tmp`;
	writeFileSync(tmp, lines.length ? `${lines.join('\n')}\n` : '');
	renameSync(tmp, file);
}

const resultKey = (r) => `${r.lane}:${r.task}:${r.id}`;
const judgedKey = (r) => `${r.task}:${r.id}:${r.b}`;

function loadRuns() {
	if (!existsSync(RUNS_FILE)) return { runs: [], keyProbe: null };
	return JSON.parse(readFileSync(RUNS_FILE, 'utf8'));
}

function gitSha() {
	try {
		return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
	} catch {
		return null;
	}
}

async function pool(items, n, fn) {
	let i = 0;
	await Promise.all(
		Array.from({ length: Math.min(n, items.length) }, async () => {
			while (i < items.length) await fn(items[i++]);
		}),
	);
}

const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));

// One call with retries on rate limits, gateway errors and timeouts, honouring
// Retry-After. A row that still fails is recorded as failed, never dropped.
// Every attempt that ended without an answer is handed to onUnanswered, because
// the row keeps only the attempt that settled it.
async function callWithRetry(lane, req, onUnanswered) {
	let res;
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		res = await callLane(lane, req);
		res.attempts = attempt;
		const kind = attemptKind(res);
		if (kind) onUnanswered(kind);
		if (!kind || attempt === MAX_ATTEMPTS) return res;
		const after = Number(res.retryAfter);
		const delay = Math.min(MAX_WAIT_S, Number.isFinite(after) && after > 0 ? after : 5 * 2 ** (attempt - 1));
		console.warn(`  ${lane.name} ${res.status || res.error}: retry ${attempt}/${MAX_ATTEMPTS - 1} in ${delay}s`);
		await wait(delay);
	}
	return res;
}

// What the judge reads for one answer: the reply as production would ship it,
// with any tool calls written out, since a tool call is the answer on tool turns.
function answerForJudge(r) {
	const tools = (r.toolCalls || []).map((c) => `[tool call] ${c.name}(${typeof c.args === 'string' ? c.args : JSON.stringify(c.args)})`);
	return [r.shipped ?? r.text ?? '', ...tools].filter(Boolean).join('\n') || '(empty reply)';
}

async function callJudge(judge, { system, user }) {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), 60_000);
	try {
		const res = await fetch(judge.url, {
			method: 'POST',
			headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env[judge.keyEnv]}` },
			body: JSON.stringify({ model: judge.model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: 1024, temperature: 0, ...judge.extraBody }),
			signal: ctrl.signal,
		});
		const data = await res.json().catch(() => null);
		if (!res.ok) throw new Error(`${judge.name} ${res.status}: ${String(data?.error?.message || data?.error || '').slice(0, 200)}`);
		return data?.choices?.[0]?.message?.content || '';
	} finally {
		clearTimeout(timer);
	}
}

function dateOnly(iso) {
	return String(iso).slice(0, 10);
}

function keyProbeNote(probe) {
	if (!probe) return 'The Grok lanes have not been run yet.';
	return `The live Grok call (one real request to ${new URL(LANES.grok.url).host} with no key, ${dateOnly(probe.at)}) returned HTTP ${probe.status}: "${probe.error}". The process running the eval had no GROK_API_KEY in its environment. The Grok columns need the key there and nowhere else: nothing has to be installed on the production service.`;
}

// Grok rows whose current-lane partner answered but that no judge has scored.
function pairsWaiting(results, judged) {
	let n = 0;
	for (const r of results.values()) {
		if (r.lane === 'current' || !r.ok) continue;
		if (results.get(`current:${r.task}:${r.id}`)?.ok && !judged.has(`${r.task}:${r.id}:${r.lane}`)) n++;
	}
	return n;
}

function judgeNote(judged, waiting) {
	const used = [...new Set(judged.map((j) => j.judge))];
	const order = JUDGES.map((j) => `${j.name} \`${j.model}\``).join(', then ');
	const rule = `The judge is the first configured of ${order}, skipping any model that produced either answer (so never Nemotron 3 Ultra against the current lane, and never Grok).`;
	const owed = waiting
		? ` ${waiting} ${waiting === 1 ? 'pair is' : 'pairs are'} answered by both lanes and still waiting for the judge: the run that made the Grok calls had no judge key (${JUDGES.map((j) => j.keyEnv).join(', ')}) in its environment. The second command under "Reproduce" judges them without calling xAI again.`
		: '';
	if (!used.length) {
		if (waiting) return `No pairs judged yet, so every comparison on this page is the objective score alone.${owed} ${rule}`;
		return `No pairs judged yet: a pair needs the current lane and a Grok lane on the same input, so the judge runs with the Grok columns. ${rule}`;
	}
	const consistent = judged.filter((j) => j.consistent).length;
	return `Judge used: ${used.join(', ')}. ${consistent} of ${judged.length} pairs got the same verdict in both orders; the rest score as the average of the two orders.${owed}`;
}

// Write the Grok calls an earlier run made without database access into the
// xAI credit ledger, once each. A row counts as written only when the ledger
// holds its response id afterwards, so a dropped insert is tried again next run.
async function settleLedger(results, ledger) {
	const owed = unledgered([...results.values()], LANES);
	if (!owed.length) return;
	const { sql } = await import('../api/_lib/db.js');
	const ids = owed.map((r) => r.responseId);
	const inLedger = async () => new Set((await sql`select request_id from xai_usage where lane = 'eval' and request_id = any(${ids})`).map((x) => x.request_id));
	const before = await inLedger();
	for (const r of owed) if (!before.has(r.responseId)) ledger.recordXaiUsage(ledgerInput(r, { backfilled: true }));
	await ledger.flushXaiUsage();
	const after = await inLedger();
	let settled = 0;
	for (const r of owed) {
		if (!after.has(r.responseId)) continue;
		results.set(resultKey(r), { ...r, ledgered: true });
		settled++;
	}
	compactJsonl(RESULTS_FILE, results);
	console.log(`xAI ledger: wrote ${settled} of ${owed.length} Grok calls an earlier run made without database access`);
}

async function writeReport(sets, results, judged, runs) {
	const lastRun = runs.runs.at(-1);
	const { markdown, recommendations } = buildReport({
		results: [...results.values()],
		judged: [...judged.values()],
		sets,
		taskInfo: TASK_INFO,
		lanes: LANES,
		meta: {
			generatedOn: lastRun ? dateOnly(lastRun.finishedAt || lastRun.startedAt) : dateOnly(new Date().toISOString()),
			production: PRODUCTION_NOTE,
			keyProbe: keyProbeNote(runs.keyProbe),
			judgeNote: judgeNote([...judged.values()], pairsWaiting(results, judged)),
			unanswered: tallyUnanswered(runs.runs),
			callLimitMs: CALL_LIMIT_MS,
			usageOf: (r) => {
				const u = normalizeXaiUsage(r.usage);
				return { ...u, reportedMicro: u.costMicro, listMicro: priceTableCostMicro(r.model, u) };
			},
		},
	});
	mkdirSync(dirname(REPORT_FILE), { recursive: true });
	writeFileSync(REPORT_FILE, markdown);
	return recommendations;
}

function printSummary(sets, results) {
	for (const task of TASKS) {
		for (const lane of Object.keys(LANES)) {
			const rows = [...results.values()].filter((r) => r.task === task && r.lane === lane);
			if (!rows.length) continue;
			const s = laneSummary(rows, sets[task].length);
			console.log(`  ${task.padEnd(15)} ${lane.padEnd(12)} pass ${(s.pass.mean * 100).toFixed(0)}% (${(s.pass.lo * 100).toFixed(0)} to ${(s.pass.hi * 100).toFixed(0)}) answered ${s.answered}/${s.setSize} p50 ${s.p50 ?? 'n/a'} ms p95 ${s.p95 ?? 'n/a'} ms`);
		}
	}
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	const sets = loadSets();
	mkdirSync(OUT_DIR, { recursive: true });
	const results = readJsonl(RESULTS_FILE, resultKey);
	const judged = readJsonl(JUDGED_FILE, judgedKey);
	const runs = loadRuns();

	if (opts.regrade) {
		for (const [key, r] of results) {
			if (!r.ok) continue;
			const row = sets[r.task]?.find((x) => x.id === r.id);
			if (!row) continue;
			const g = grade(r.task, row, { text: r.text, toolCalls: r.toolCalls });
			results.set(key, { ...r, pass: Boolean(g.pass), checks: g.checks ?? null, reason: g.reason ?? null, shipped: g.shipped ?? null, advisory: g.advisory ?? null });
		}
		compactJsonl(RESULTS_FILE, results);
		console.log(`re-graded ${results.size} saved results`);
	}

	if (opts.report || opts.regrade) {
		await writeReport(sets, results, judged, runs);
		console.log(`report written: ${relative(ROOT, REPORT_FILE)}`);
		printSummary(sets, results);
		return;
	}

	if (opts.prodEnv) {
		const n = loadCloudRunEnv({ wanted: ENV_WANTED, required: ['NVIDIA_API_KEY'], keep: XAI_KEY_ENVS });
		console.log(`loaded ${n} env vars from Cloud Run`);
	}
	const grokKeyed = opts.lanes.some((l) => LANES[l].provider === 'grok' && laneKey(LANES[l]));
	if (!grokKeyed) delete process.env.DATABASE_URL;
	for (const k of ['REDIS_URL', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN']) delete process.env[k];
	if (opts.lanes.includes('current') && !process.env.NVIDIA_API_KEY) usage('the current lane needs NVIDIA_API_KEY; pass --prod-env');
	const ledger = grokKeyed && process.env.DATABASE_URL ? await import('../api/_lib/xai-usage.js') : null;
	if (grokKeyed && !ledger) console.warn('DATABASE_URL is unset: Grok spend from this run waits in the results file and reaches the xAI ledger on the next --prod-env run');
	if (ledger) await settleLedger(results, ledger);

	const run = { startedAt: new Date().toISOString(), commit: gitSha(), lanes: opts.lanes, tasks: opts.tasks, rows: 0 };
	const failedLanes = [];

	for (const laneName of opts.lanes) {
		const lane = LANES[laneName];
		if (!laneKey(lane)) {
			const first = sets[opts.tasks[0]][0];
			const res = await callLane(lane, buildRequest(opts.tasks[0], first));
			runs.keyProbe = { lane: laneName, model: lane.model, status: res.status, error: res.ok ? null : res.error, at: new Date().toISOString() };
			console.log(`${laneName}: no ${XAI_KEY_ENVS.join(' or ')} in this process's environment; live probe returned HTTP ${res.status}${res.ok ? '' : ` (${res.error})`}. Skipping the set.`);
			continue;
		}
		const todo = [];
		for (const task of opts.tasks) {
			let rows = sets[task];
			if (opts.only) rows = rows.filter((r) => opts.only.has(r.id));
			if (opts.limit) rows = rows.slice(0, opts.limit);
			for (const row of rows) {
				const prev = results.get(`${laneName}:${task}:${row.id}`);
				if (!prev || opts.force || (opts.retryFailed && !prev.ok)) todo.push({ task, row });
			}
		}
		console.log(`${laneName} (${lane.model}): ${todo.length} calls to run`);
		let done = 0;
		let okCount = 0;
		await pool(todo, opts.concurrency, async ({ task, row }) => {
			const req = buildRequest(task, row);
			const res = await callWithRetry(lane, req, (kind) => {
				run.unanswered ??= {};
				run.unanswered[laneName] ??= {};
				run.unanswered[laneName][kind] = (run.unanswered[laneName][kind] || 0) + 1;
			});
			const graded = res.ok ? grade(task, row, { text: res.text, toolCalls: res.toolCalls }) : { pass: false, checks: null, reason: `error ${res.status}`, shipped: null };
			const rec = {
				task,
				id: row.id,
				lane: laneName,
				model: lane.model,
				ok: res.ok,
				status: res.status,
				error: res.ok ? null : res.error,
				latencyMs: res.latencyMs,
				attempts: res.attempts,
				costMicro: res.ok ? res.costMicro : null,
				usage: res.ok ? res.usage : null,
				text: res.ok ? res.text : null,
				toolCalls: res.ok ? res.toolCalls : [],
				pass: Boolean(graded.pass),
				checks: graded.checks ?? null,
				reason: graded.reason ?? null,
				shipped: graded.shipped ?? null,
				advisory: graded.advisory ?? null,
				at: new Date().toISOString(),
			};
			if (lane.provider === 'grok') {
				rec.responseId = res.ok ? res.responseId : null;
				rec.ledgered = Boolean(res.ok && ledger);
				if (rec.ledgered) ledger.recordXaiUsage(ledgerInput(rec));
			}
			results.set(resultKey(rec), rec);
			judged.delete(`${task}:${row.id}:${laneName}`);
			for (const other of Object.keys(LANES)) if (laneName === 'current') judged.delete(`${task}:${row.id}:${other}`);
			appendFileSync(RESULTS_FILE, `${jsonLine(rec)}\n`);
			done++;
			if (res.ok) okCount++;
			run.rows++;
			console.log(`[${laneName} ${done}/${todo.length}] ${task} ${row.id} ${res.ok ? `${rec.pass ? 'pass' : `FAIL ${rec.reason}`} ${res.latencyMs} ms` : `ERROR ${res.status} ${res.error}`}`);
		});
		if (todo.length && okCount === 0) failedLanes.push(laneName);
		if (okCount && lane.provider === 'grok') runs.keyProbe = null;
	}
	if (ledger) await ledger.flushXaiUsage();

	if (opts.judge) {
		const pending = [];
		for (const r of results.values()) {
			if (r.lane === 'current' || !r.ok || !opts.tasks.includes(r.task)) continue;
			const cur = results.get(`current:${r.task}:${r.id}`);
			if (cur?.ok && !judged.has(`${r.task}:${r.id}:${r.lane}`)) pending.push({ cur, other: r });
		}
		const judge = pickJudge([LANES.current.model, ...Object.values(LANES).filter((l) => l.provider === 'grok').map((l) => l.model)]);
		if (pending.length && !judge) console.warn(`judge: ${pending.length} pairs waiting but no judge key is set (${JUDGES.map((j) => j.keyEnv).join(', ')})`);
		if (pending.length && judge) {
			console.log(`judge (${judge.name} ${judge.model}): ${pending.length} pairs`);
			const row = (task, id) => sets[task].find((x) => x.id === id);
			await pool(pending, Math.min(opts.concurrency, 4), async ({ cur, other }) => {
				try {
					const v = await judgePair({
						task: other.task,
						input: judgeInput(other.task, row(other.task, other.id)),
						a: answerForJudge(other),
						b: answerForJudge(cur),
						call: (m) => callJudge(judge, m),
					});
					if (v.score === null) throw new Error(`no usable verdict (${v.verdicts.join(', ')})`);
					const rec = { task: other.task, id: other.id, a: 'current', b: other.lane, judge: `${judge.name} ${judge.model}`, score: v.score, verdicts: v.verdicts, consistent: v.consistent, at: new Date().toISOString() };
					judged.set(judgedKey(rec), rec);
					appendFileSync(JUDGED_FILE, `${jsonLine(rec)}\n`);
				} catch (err) {
					console.warn(`  judge ${other.task} ${other.id} ${other.lane}: ${err.message}`);
				}
			});
		}
	}

	compactJsonl(RESULTS_FILE, results);
	compactJsonl(JUDGED_FILE, judged);
	run.finishedAt = new Date().toISOString();
	runs.runs.push(run);
	writeFileSync(RUNS_FILE, `${JSON.stringify(runs, null, 2)}\n`);
	const recs = await writeReport(sets, results, judged, runs);
	console.log(`report written: ${relative(ROOT, REPORT_FILE)}`);
	printSummary(sets, results);
	for (const r of recs) console.log(`  ${r.task}: ${r.route ? `${r.route.env}=${r.route.value}` : 'keep the current lane'}`);
	if (failedLanes.length) {
		console.error(`every call failed on: ${failedLanes.join(', ')}`);
		process.exit(1);
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((err) => {
		console.error(`grok-eval-llm: ${err?.stack || err}`);
		process.exit(2);
	});
}
