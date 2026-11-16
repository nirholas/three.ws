#!/usr/bin/env node
// Day-0 NIM lane eval, from the command line.
//
// The same code the queued cron runs (api/cron/nim-release-eval.js over
// api/_lib/nim-lane-eval.js): classify a NIM model by probing it, run its
// lane's versioned eval set (data/evals/<lane>/vN.json) against it and the
// lane's current first rung, and write the report as JSON, markdown, the
// config diff and the post draft.
//
// USAGE
//   node scripts/nvidia-lane-eval.mjs --model nvidia/nemotron-3.5-embed-1b
//   node scripts/nvidia-lane-eval.mjs --model <id> --lane chat     # skip classification
//   node scripts/nvidia-lane-eval.mjs --backfill                   # the visibility-map backlog
//   node scripts/nvidia-lane-eval.mjs --pipeline <id>              # end-to-end proof, see below
//   node scripts/nvidia-lane-eval.mjs ... --out <dir>              # default docs/nvidia/evals
//
// Reports land at <out>/<lane>/<model-slug>.{json,md} plus .diff when the
// verdict produced one (lane "unclassified" when no lane answered).
//
// --pipeline runs the production path end to end on a throwaway in-process
// Postgres (scripts/lib/isolated-db.mjs, never the production database): it
// takes the LIVE NIM catalog, seeds the release snapshot with every id except
// <id>, runs the audit's watchNvidiaReleases so it sees <id> as a new release
// and enqueues it, then runs the cron's runNextReleaseEval, which claims the
// row, evaluates it and stores the result. The stored row and both ops alerts
// are written to <out>/pipeline/<model-slug>.md as evidence.
//
// NVIDIA_API_KEY comes from the environment, or, when unset, from the live
// Cloud Run service via scripts/read-service-env.mjs. It is never printed.
//
// Nothing here edits production config: the diff is written to a report file
// for a human to apply.

import { execFileSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** Release ids docs/nvidia-visibility-map.md lists as unwired backlog. */
const BACKFILL = Object.freeze([
	'nvidia/nemotron-3.5-super-vl-120b-a12b',
	'nvidia/nemotron-3.5-embed-1b',
	'nvidia/nemotron-3.5-embed-8b',
]);

function parseArgs(argv) {
	const out = { model: null, lane: null, backfill: false, pipeline: null, outDir: path.join(ROOT, 'docs/nvidia/evals') };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--model') out.model = argv[++i];
		else if (a === '--lane') out.lane = argv[++i];
		else if (a === '--backfill') out.backfill = true;
		else if (a === '--pipeline') out.pipeline = argv[++i];
		else if (a === '--out') out.outDir = path.resolve(argv[++i]);
		else if (a === '--help' || a === '-h') out.help = true;
		else throw new Error(`unknown argument: ${a}`);
	}
	return out;
}

function resolveKey() {
	if (process.env.NVIDIA_API_KEY) return process.env.NVIDIA_API_KEY;
	try {
		const key = execFileSync(process.execPath, [path.join(ROOT, 'scripts/read-service-env.mjs'), '^NVIDIA_API_KEY$', '--raw'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
		if (key) return key;
	} catch (err) {
		throw new Error(`NVIDIA_API_KEY is unset and could not be read from the Cloud Run service: ${String(err.stderr || err.message).trim().slice(0, 200)}`);
	}
	throw new Error('NVIDIA_API_KEY is unset and the Cloud Run service returned an empty value');
}

const slug = (id) => id.replace(/[^a-zA-Z0-9.-]+/g, '_');
const pct = (n) => (n == null ? 'n/a' : `${Math.round(n * 100)}%`);

/** Write one report's files; returns the paths written (repo-relative). */
async function writeReport(outDir, report) {
	const dir = path.join(outDir, report.lane || 'unclassified');
	await mkdir(dir, { recursive: true });
	const base = path.join(dir, slug(report.modelId));
	const { markdown, ...data } = report;
	const written = [];
	await writeFile(`${base}.json`, `${JSON.stringify(data, null, '\t')}\n`);
	written.push(`${base}.json`);
	await writeFile(`${base}.md`, markdown);
	written.push(`${base}.md`);
	if (report.diff?.patch) {
		await writeFile(`${base}.diff`, report.diff.patch);
		written.push(`${base}.diff`);
	} else {
		// A rerun that yields no diff must not leave an earlier run's diff behind.
		await rm(`${base}.diff`, { force: true });
	}
	return written.map((p) => path.relative(ROOT, p));
}

function summaryLine(r) {
	if (!r.lane) return `${r.modelId}: no lane (${r.classification.availability}): ${r.classification.reason}`;
	const c = r.candidate;
	const i = r.incumbent;
	return `${r.modelId}: ${r.lane} ${String(r.verdict).toUpperCase()}  quality ${pct(c.quality)} vs ${i ? `${pct(i.quality)} (${i.model})` : 'n/a'}  p50 ${c.latencyMs.p50} ms vs ${i?.latencyMs.p50 ?? 'n/a'} ms  errors ${pct(c.errorRate)}  format ${pct(c.formatAdherence)}`;
}

async function runModels(ids, { lane, outDir, key }) {
	// The eval reads production config modules; make sure nothing they import
	// can reach the production database from a laptop.
	process.env.DATABASE_URL = 'postgres://lane-eval.invalid/none';
	const { nimClient, NIM_BASE } = await import('../api/_lib/nim-lanes.js');
	const { evaluateRelease } = await import('../api/_lib/nim-lane-eval.js');
	const { listCatalog } = await import('../api/cron/free-model-audit.js');
	const owners = new Map((await listCatalog(NIM_BASE, key)).map((m) => [m.id, m.ownedBy]));
	const client = nimClient({ key });
	for (const id of ids) {
		if (!owners.has(id)) console.warn(`${id} is not in the live NIM catalog listing; evaluating it anyway`);
		const report = await evaluateRelease({ modelId: id, ownedBy: owners.get(id) ?? null, client, lane, day0: false });
		const files = await writeReport(outDir, report);
		console.log(summaryLine(report));
		for (const f of files) console.log(`  wrote ${f}`);
	}
}

async function runPipeline(modelId, { outDir, key }) {
	process.env.DATABASE_URL = 'postgres://isolated.invalid/lane-eval';
	const { useIsolatedDb } = await import('./lib/isolated-db.mjs');
	const db = await useIsolatedDb();
	const { watchNvidiaReleases, listCatalog } = await import('../api/cron/free-model-audit.js');
	const { runNextReleaseEval } = await import('../api/cron/nim-release-eval.js');
	const { nimClient, NIM_BASE } = await import('../api/_lib/nim-lanes.js');
	const { getReleaseEval } = await import('../api/_lib/nim-release-store.js');

	const catalog = await listCatalog(NIM_BASE, key);
	if (!catalog.some((m) => m.id === modelId)) throw new Error(`${modelId} is not in the live NIM catalog (${catalog.length} ids listed)`);
	const snapshot = new Map([['nim-catalog-seen', catalog.map((m) => m.id).filter((id) => id !== modelId)]]);
	const alerts = [];
	const alert = async (title, detail, opts) => { alerts.push({ title, detail, opts }); };

	const watch = await watchNvidiaReleases({
		base: NIM_BASE,
		key,
		cacheKey: 'nim-catalog-seen',
		get: async (k) => snapshot.get(k) ?? null,
		set: async (k, v) => { snapshot.set(k, v); },
		alert,
	});
	console.log(`audit: status ${watch.status}, added ${watch.added.join(', ')}, queued ${watch.evals?.queued.join(', ') || 'none'}`);
	if (!watch.evals?.queued.includes(modelId)) throw new Error(`the audit did not queue ${modelId}: ${JSON.stringify(watch.evals)}`);

	const run = await runNextReleaseEval({ client: nimClient({ key }), alert });
	console.log(`eval: ${run.status} ${run.modelId} lane ${run.lane} verdict ${run.verdict}`);
	const row = await getReleaseEval({ modelId });
	const counts = await db.sql`select status, count(*)::int as n from nim_release_evals group by status`;

	const md = [
		`# Day-0 pipeline run: \`${modelId}\``,
		'',
		`Run ${new Date().toISOString()} with \`node scripts/nvidia-lane-eval.mjs --pipeline ${modelId}\`.`,
		'Live NIM catalog and live model calls; the queue and result rows lived in a throwaway in-process Postgres built from the production schema plus every migration (scripts/lib/isolated-db.mjs), not the production database.',
		'',
		'## What ran',
		'',
		`1. \`watchNvidiaReleases\` (api/cron/free-model-audit.js) listed the live catalog (${catalog.length} ids) against a snapshot without \`${modelId}\`, saw it as new (status \`${watch.status}\`) and enqueued it: queued ${JSON.stringify(watch.evals.queued)}.`,
		`2. \`runNextReleaseEval\` (api/cron/nim-release-eval.js) claimed row ${row.id}, evaluated it and stored the result: status \`${row.status}\`, lane \`${row.lane}\`, verdict \`${row.verdict}\`, attempts ${row.attempts}.`,
		`3. Queue after the run: ${counts.map((c) => `${c.status} ${c.n}`).join(', ')}.`,
		'',
		'## Stored row',
		'',
		'| Column | Value |',
		'|---|---|',
		...['id', 'model_id', 'owned_by', 'source', 'status', 'attempts', 'lane', 'verdict', 'created_at', 'started_at', 'completed_at'].map((k) => `| ${k} | ${row[k] instanceof Date ? row[k].toISOString() : row[k] ?? ''} |`),
		`| config_diff | ${row.config_diff ? `${row.config_diff.length} chars` : 'null'} |`,
		`| post_draft | ${row.post_draft ? `${row.post_draft.length} chars` : 'null'} |`,
		`| report_md | ${row.report_md ? `${row.report_md.length} chars` : 'null'} |`,
		'',
		'## Ops alerts sent',
		'',
		...alerts.flatMap((a) => [`### ${a.title}`, '', `Signature \`${a.opts?.signature}\`.`, '', '```text', a.detail.trimEnd(), '```', '']),
		'## Stored report (report_md)',
		'',
		row.report_md.replace(/^# /m, '### '),
	].join('\n');
	const dir = path.join(outDir, 'pipeline');
	await mkdir(dir, { recursive: true });
	const file = path.join(dir, `${slug(modelId)}.md`);
	await writeFile(file, `${md.trimEnd()}\n`);
	console.log(`  wrote ${path.relative(ROOT, file)}`);
	if (row.status !== 'done' || !row.verdict || !row.report_md) throw new Error(`pipeline row incomplete: ${row.status} ${row.last_error || ''}`);
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help || (!args.model && !args.backfill && !args.pipeline)) {
		console.log('usage: node scripts/nvidia-lane-eval.mjs (--model <id> [--lane <lane>] | --backfill | --pipeline <id>) [--out <dir>]');
		process.exit(args.help ? 0 : 1);
	}
	const key = resolveKey();
	if (args.pipeline) return runPipeline(args.pipeline, { outDir: args.outDir, key });
	return runModels(args.backfill ? BACKFILL : [args.model], { lane: args.lane, outDir: args.outDir, key });
}

main().then(() => process.exit(0), (err) => {
	console.error(`nvidia-lane-eval: ${err.message}`);
	process.exit(1);
});
