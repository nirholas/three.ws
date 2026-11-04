#!/usr/bin/env node
// Run an agent eval suite from the command line.
//
//   npm run evals -- --list
//   npm run evals -- --suite smoke [--preset default | --agent <id>] [--model <id>] [--task a,b] [--json out.json] [--md out.md]
//   npm run evals -- --compare baseline.json candidate.json
//   npm run evals -- --suite smoke --gate        (npm run gate: skips cleanly with no model key)
//
// The run is local: it uses the model keys in .env / .env.local and the same
// agent loop the platform serves, pinned to one model (api/_lib/evals/models.js).
// --agent loads a real agent's persona and tools from the database
// (DATABASE_URL). Reports land in evals/reports/ in the three-ws/eval-report@1
// shape the Evaluate tab stores. Exit code is 1 when any task fails or the run
// errors, 0 when every task passes, 2 for a usage error. With --gate the verdict is the suite's gate.minScore instead.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFile(path) {
	if (!existsSync(path)) return;
	for (const line of readFileSync(path, 'utf8').split('\n')) {
		const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
		if (!m || m[1] in process.env) continue;
		process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
	}
}
loadEnvFile(resolve(ROOT, '.env.local'));
loadEnvFile(resolve(ROOT, '.env'));

const { values: flags, positionals } = parseArgs({
	options: {
		suite: { type: 'string' },
		preset: { type: 'string', default: 'default' },
		agent: { type: 'string' },
		model: { type: 'string' },
		task: { type: 'string' },
		json: { type: 'string' },
		md: { type: 'string' },
		compare: { type: 'boolean', default: false },
		list: { type: 'boolean', default: false },
		gate: { type: 'boolean', default: false },
		help: { type: 'boolean', short: 'h', default: false },
	},
	allowPositionals: true,
	strict: true,
});

const HELP = `Usage: npm run evals -- [options]
  --list                      list suites, presets and runnable models
  --suite <name|path>         suite to run (see --list)
  --preset <id>               configuration preset (default: default)
  --agent <id>                score a real agent instead of a preset (needs DATABASE_URL)
  --model <id>                pin the model (default: first free or Vertex lane)
  --task <ids>                comma-separated task ids to run
  --json <file>               also write the report JSON here
  --md <file>                 also write the report as Markdown
  --compare <a.json> <b.json> diff two reports
  --gate                      CI mode: skip with exit 0 when no model key is configured`;

function die(msg, code = 2) {
	console.error(msg);
	process.exit(code);
}

function writeOut(file, text) {
	const p = resolve(process.cwd(), file);
	mkdirSync(dirname(p), { recursive: true });
	writeFileSync(p, text);
	return p;
}

if (flags.help) {
	console.log(HELP);
	process.exit(0);
}

const evals = await import('../api/_lib/evals/runner.js');
const { listSuiteNames, loadSuite, describeSuite, SuiteError } = await import('../api/_lib/evals/suites.js');
const { listPresets, presetConfig, agentConfig } = await import('../api/_lib/evals/configs.js');
const { evalRung, listEvalModels, ModelUnavailableError } = await import('../api/_lib/evals/models.js');

if (flags.list) {
	console.log('Suites');
	for (const name of listSuiteNames()) {
		const d = describeSuite(loadSuite(name));
		console.log(`  ${d.name}  v${d.version}  ${d.tasks.length} tasks  ${d.title || ''}`);
	}
	console.log('Presets');
	for (const p of listPresets()) console.log(`  ${p.id}  ${p.summary || ''}`);
	console.log('Models with a key configured here');
	const models = listEvalModels();
	if (!models.length) console.log('  none (set a provider key in .env, or GOOGLE_CLOUD_PROJECT for Vertex)');
	for (const m of models) console.log(`  ${m.id}  ${m.free ? 'free' : m.credits ? 'gcp credits' : 'paid'}`);
	process.exit(0);
}

if (flags.compare) {
	const [a, b] = positionals;
	if (!a || !b) die('--compare needs two report files.');
	const read = (f) => JSON.parse(readFileSync(resolve(process.cwd(), f), 'utf8'));
	try {
		console.log(evals.renderComparisonMarkdown(evals.compareReports(read(a), read(b))));
	} catch (err) {
		die(err.message);
	}
	process.exit(0);
}

if (!flags.suite) die(`--suite is required.\n\n${HELP}`);

let suite;
try {
	suite = loadSuite(flags.suite);
} catch (err) {
	if (err instanceof SuiteError) die(`${err.message}\n${(err.problems || []).map((p) => `  ${p}`).join('\n')}`);
	throw err;
}

function pickModel() {
	if (flags.model) return flags.model;
	const models = listEvalModels();
	if (flags.gate) {
		const wanted = (suite.gate?.models || []).find((id) => models.some((m) => m.id === id));
		if (wanted) return wanted;
	}
	return (models.find((m) => m.free) || models.find((m) => m.credits) || models[0])?.id || null;
}

const model = pickModel();
let rung;
try {
	if (!model) throw new ModelUnavailableError('(none)', 'no provider key is configured');
	rung = evalRung(model);
} catch (err) {
	if (!(err instanceof ModelUnavailableError)) throw err;
	if (flags.gate) {
		console.log(`evals: skipped (${err.message})`);
		process.exit(0);
	}
	die(err.message, 1);
}

let config;
if (flags.agent) {
	const { sql } = await import('../api/_lib/db.js');
	const [row] = await sql`SELECT id, name, description, persona_prompt, meta FROM agent_identities WHERE id = ${flags.agent} AND deleted_at IS NULL`;
	if (!row) die(`No agent ${flags.agent}.`, 1);
	config = agentConfig(row, suite.defaults || {});
} else {
	try {
		config = presetConfig(flags.preset, suite.defaults || {});
	} catch (err) {
		die(err.message);
	}
}

const only = flags.task ? flags.task.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
console.log(`Running ${suite.name} v${suite.version} (${only?.length || suite.tasks.length} tasks) on ${model} as ${config.label} [${config.version}]`);

let report;
try {
	report = await evals.runSuite(suite, config, {
		rung,
		model,
		only,
		onTask: (row, i, total) => {
			const mark = row.status === 'passed' ? 'pass' : row.status === 'failed' ? 'FAIL' : 'ERR ';
			console.log(`  [${i + 1}/${total}] ${mark}  ${row.id}  ${row.trace.steps} steps  ${row.trace.latencyMs} ms`);
			for (const c of row.checks.filter((x) => !x.passed)) console.log(`           - ${c.detail}`);
			if (row.error) console.log(`           - ${row.error}`);
		},
	});
} catch (err) {
	die(`Eval failed: ${err.message}`, 1);
}

const stamp = report.finishedAt.replace(/[:.]/g, '-');
const defaultPath = resolve(ROOT, 'evals/reports', `${suite.name}-${model.replace(/[^\w.-]+/g, '_')}-${stamp}.json`);
mkdirSync(dirname(defaultPath), { recursive: true });
writeFileSync(defaultPath, `${JSON.stringify(report, null, 2)}\n`);
if (flags.json) writeOut(flags.json, `${JSON.stringify(report, null, 2)}\n`);
if (flags.md) writeOut(flags.md, evals.renderReportMarkdown(report));

const s = report.summary;
console.log(`\n${s.passed}/${s.tasks} passed, ${s.failed} failed, ${s.errored} errored. Score ${s.score ?? 'n/a'}, cost ${s.costUsd == null ? 'n/a' : `$${s.costUsd}`}.`);
console.log(`Report: ${defaultPath}`);
if (flags.gate) {
	const min = suite.gate?.minScore ?? 1;
	if (s.score == null) {
		console.log('evals: skipped the gate verdict (every task hit a lane error, nothing was scored)');
		process.exit(0);
	}
	console.log(`Gate: score ${s.score} against minimum ${min}.`);
	process.exit(s.score >= min ? 0 : 1);
}
process.exit(s.failed > 0 || s.errored > 0 ? 1 : 0);
