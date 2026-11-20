#!/usr/bin/env node
// Read and label the Forge judge comparison rows (forge_judge_shadow) from a
// workstation: where the current quality judge and Cosmos Reason disagree, with
// the four judging views, both verdicts and the operator's label. Labels feed
// the next scripts/cosmos-judge-eval.mjs run and the promotion rule.
//
// There is deliberately no admin page or admin HTTP endpoint for this: an
// operator reviews here, with their own gcloud login (api/_lib/forge-judge-board.js).
//
//   npm run forge:judge -- --prod-env                              unlabelled... see --view
//   npm run forge:judge -- --prod-env --view unlabelled --save-views ./judge-views
//   npm run forge:judge -- --prod-env --view all --source eval --issue floating_parts
//   npm run forge:judge -- --prod-env label <row-id> accepted|rejected|clear
//
// --view        disagree (default) | cosmos_reject | unlabelled | all
// --source      all (default) | forge | eval
// --issue       only rows where Cosmos named this issue
// --limit N     rows per page (1 to 100, default 20); --before <row-id> pages on
// --save-views  write each row's four PNG views to <dir>/<row-id>/<view>.png so
//               they can be opened locally; reads R2 with the GCS fallback
// --prod-env    read DATABASE_URL, S3_* and STORAGE_FALLBACK_* from the
//               three-ws-api Cloud Run service into this process only; nothing
//               but the requested views is written to disk.
//
// Exit codes: 0 ok; 1 label found no row with that id; 2 usage error.

import os from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SERVICE, loadCloudRunEnv } from './lib/cloud-run-env.mjs';

const VIEWS = ['disagree', 'cosmos_reject', 'unlabelled', 'all'];
const SOURCES = ['forge', 'eval', 'all'];
const LABEL_ARGS = { accepted: 'accepted', rejected: 'rejected', clear: null };

function usage(msg) {
	if (msg) console.error(`forge-judge: ${msg}`);
	console.error('Usage: npm run forge:judge -- [--prod-env] [--view V] [--source S] [--issue I] [--limit N] [--before ID] [--save-views DIR]');
	console.error('       npm run forge:judge -- [--prod-env] label <row-id> accepted|rejected|clear');
	process.exit(2);
}

function parseArgs(argv) {
	const out = { prodEnv: false, view: 'disagree', source: 'all', issue: null, limit: 20, before: null, saveViews: null, label: null };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		const next = () => (i + 1 < argv.length ? argv[++i] : usage(`${a} needs a value`));
		if (a === '--prod-env') out.prodEnv = true;
		else if (a === '--view') out.view = next();
		else if (a === '--source') out.source = next();
		else if (a === '--issue') out.issue = next();
		else if (a === '--limit') out.limit = Number(next());
		else if (a === '--before') out.before = next();
		else if (a === '--save-views') out.saveViews = resolve(next());
		else if (a === 'label') out.label = { id: next(), value: next() };
		else usage(`unknown argument ${a}`);
	}
	if (!VIEWS.includes(out.view)) usage(`--view must be one of ${VIEWS.join(', ')}`);
	if (!SOURCES.includes(out.source)) usage(`--source must be one of ${SOURCES.join(', ')}`);
	if (!Number.isInteger(out.limit) || out.limit < 1 || out.limit > 100) usage('--limit must be 1 to 100');
	if (out.before !== null && !/^\d+$/.test(out.before)) usage('--before must be a row id');
	if (out.label) {
		if (!/^\d+$/.test(out.label.id)) usage('label needs a row id');
		if (!(out.label.value in LABEL_ARGS)) usage('label must be accepted, rejected or clear');
	}
	return out;
}

// Prompts were typed by the public: strip control characters before printing.
const safe = (text, max = 240) =>
	String(text ?? '')
		.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')
		.slice(0, max);
const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}% of ${d}` : 'no labels yet');

function verdictLine(name, v, pass) {
	if (!v || pass === null || pass === undefined) return `${name.padEnd(8)} no verdict${v?.reason ? ` (${safe(v.reason, 80)})` : ''}`;
	const bits = [pass ? 'pass' : 'REJECT'];
	if (v.score != null) bits.push(`score ${v.score}`);
	if (Array.isArray(v.issues) && v.issues.length) bits.push(`issues ${v.issues.map((x) => safe(x, 40)).join(', ')}`);
	if (Array.isArray(v.defects) && v.defects.length) bits.push(`defects ${v.defects.map((x) => safe(typeof x === 'string' ? x : JSON.stringify(x), 60)).join(', ')}`);
	if (v.confidence != null) bits.push(`confidence ${v.confidence}`);
	if (v.model) bits.push(safe(v.model, 60));
	return `${name.padEnd(8)} ${bits.join(', ')}`;
}

const opts = parseArgs(process.argv.slice(2));
if (opts.prodEnv) {
	const wanted = opts.saveViews ? /^(DATABASE_URL|S3_[A-Z_]+|STORAGE_FALLBACK_[A-Z_]+)$/ : /^DATABASE_URL$/;
	const n = loadCloudRunEnv({ wanted, required: ['DATABASE_URL'] });
	console.log(`loaded ${n} production env var(s) from ${SERVICE} (in memory only)`);
}
if (!process.env.DATABASE_URL) usage('DATABASE_URL is not set (pass --prod-env)');

// Imported after the env is in place: db.js and r2.js read it at load time.
const board = await import('../api/_lib/forge-judge-board.js');
const { COSMOS_ISSUE_KEYS } = await import('../api/_lib/cosmos-reason-judge.js');
if (opts.issue && !COSMOS_ISSUE_KEYS.includes(opts.issue)) usage(`--issue must be one of ${COSMOS_ISSUE_KEYS.join(', ')}`);

if (opts.label) {
	const row = await board.labelJudgeRow({ id: opts.label.id, label: LABEL_ARGS[opts.label.value], actor: `cli:${os.userInfo().username}` });
	if (!row) {
		console.error(`no shadow row ${opts.label.id}`);
		process.exit(1);
	}
	console.log(row.human_label ? `row ${row.id} labelled ${row.human_label} by ${row.labelled_by}` : `row ${row.id} label cleared`);
	process.exit(0);
}

const [t, page] = await Promise.all([
	board.judgeTotals(opts.source),
	board.listJudgeRows({ view: opts.view, source: opts.source, issue: opts.issue, limit: opts.limit, before: opts.before }),
]);
console.log(`\n${t.rows} row(s), ${t.disagree} disagreement(s), ${t.labelled} labelled, Cosmos decided ${t.cosmos_decided}`);
console.log(`current judge agrees with the label: ${t.current_labelled ? `${t.current_agrees} (${pct(t.current_agrees, t.current_labelled)})` : 'no labels yet'}`);
console.log(`Cosmos agrees with the label:        ${t.cosmos_labelled ? `${t.cosmos_agrees} (${pct(t.cosmos_agrees, t.cosmos_labelled)})` : 'no labels yet'}`);
console.log(`\nshowing ${page.rows.length} row(s): view ${opts.view}, source ${opts.source}${opts.issue ? `, issue ${opts.issue}` : ''}\n`);
if (!page.rows.length) {
	console.log(opts.view === 'unlabelled' ? 'Every disagreement is labelled.' : 'No rows match.');
	process.exit(0);
}

for (const r of page.rows) {
	console.log(`── row ${r.id}  [${r.source}]  ${new Date(r.created_at).toISOString()}${r.applied ? `  applied: ${r.applied}` : ''}`);
	if (r.creation_id) console.log(`   model    https://three.ws/m/${safe(r.creation_id, 60)}`);
	if (r.glb_url) console.log(`   glb      ${safe(r.glb_url, 300)}`);
	if (r.prompt) console.log(`   prompt   ${JSON.stringify(safe(r.prompt))}`);
	console.log(`   ${verdictLine('current', r.current, r.current_pass)}`);
	console.log(`   ${verdictLine('cosmos', r.cosmos, r.cosmos_pass)}`);
	console.log(`   label    ${r.human_label ? `${r.human_label} by ${safe(r.labelled_by, 120)}` : 'none'}`);
	if (opts.saveViews) {
		const dir = join(opts.saveViews, String(r.id));
		mkdirSync(dir, { recursive: true });
		for (const key of r.render_keys || []) {
			const file = join(dir, key.split('/').pop());
			try {
				writeFileSync(file, await board.readJudgeView(key));
				console.log(`   view     ${file}`);
			} catch (err) {
				console.log(`   view     ${key}: ${err?.message || err}`);
			}
		}
	} else if (r.render_keys?.length) {
		console.log(`   views    ${r.render_keys.length} stored (pass --save-views <dir> to open them)`);
	}
	console.log(`   keep     npm run forge:judge -- --prod-env label ${r.id} accepted`);
	console.log(`   reject   npm run forge:judge -- --prod-env label ${r.id} rejected`);
	console.log('');
}
if (page.nextBefore) console.log(`more: add --before ${page.nextBefore}`);
