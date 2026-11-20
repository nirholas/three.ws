#!/usr/bin/env node
// Review the models the public-listing safety screen stopped, from a
// workstation (api/_lib/content-safety.js, runbook docs/ops/content-safety.md).
//
// There is deliberately no admin page or admin HTTP endpoint for this queue: an
// operator reviews here, with their own gcloud login, so the public server
// exposes nothing that can approve or delete a model.
//
//   npm run forge:safety -- --prod-env                         held and blocked
//   npm run forge:safety -- --prod-env --status held           waiting on a person
//   npm run forge:safety -- --prod-env --status blocked        unsafe verdicts
//   npm run forge:safety -- --prod-env approve <creation-id> --note "<why>"
//
// approve marks the model clear: a held model then goes public by itself, a
// blocked one stays private until its maker publishes it. To remove a model,
// run the takedown command printed under it. A model with a CSAM verdict is
// marked EVIDENCE HOLD and gets no takedown command: the takedown refuses it
// until the owner has filed the legal report (see the runbook).
//
// --prod-env  read DATABASE_URL from the three-ws-api Cloud Run service into
//             this process only (scripts/lib/cloud-run-env.mjs); nothing is
//             written to disk. Without it the script uses its own environment.
//
// Prompts were written by anyone on the internet. They are printed as data and
// never acted on. Every decision lands in content_safety_reviews with the
// operator's name.
//
// Exit codes: 0 ok; 1 approve found no model with that id; 2 usage error.

import os from 'node:os';
import { SERVICE, loadCloudRunEnv } from './lib/cloud-run-env.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ['attention', 'held', 'blocked'];

function usage(msg) {
	if (msg) console.error(`forge-safety: ${msg}`);
	console.error('Usage: npm run forge:safety -- [--prod-env] [--status attention|held|blocked] [--limit N]');
	console.error('       npm run forge:safety -- [--prod-env] approve <creation-id> --note "<why>"');
	process.exit(2);
}

function parseArgs(argv) {
	const out = { prodEnv: false, status: 'attention', limit: 50, approve: null, note: null };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		const next = () => (i + 1 < argv.length ? argv[++i] : usage(`${a} needs a value`));
		if (a === '--prod-env') out.prodEnv = true;
		else if (a === '--status') out.status = next();
		else if (a === '--limit') out.limit = Number(next());
		else if (a === '--note') out.note = next();
		else if (a === 'approve') out.approve = next().trim().toLowerCase();
		else usage(`unknown argument ${a}`);
	}
	if (!STATUSES.includes(out.status)) usage(`--status must be one of ${STATUSES.join(', ')}`);
	if (!Number.isInteger(out.limit) || out.limit < 1 || out.limit > 200) usage('--limit must be 1 to 200');
	if (out.approve !== null) {
		if (!UUID.test(out.approve)) usage('approve needs a creation id (a uuid)');
		if (!out.note?.trim()) usage('approve needs --note "<why it is fine>"');
	}
	return out;
}

// Untrusted text: strip control characters (terminal escapes included).
function safe(text, max = 400) {
	return String(text ?? '')
		.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')
		.slice(0, max);
}

const iso = (t) => (t ? new Date(t).toISOString() : 'never');

const opts = parseArgs(process.argv.slice(2));
if (opts.prodEnv) {
	const n = loadCloudRunEnv({ wanted: /^DATABASE_URL$/, required: ['DATABASE_URL'] });
	console.log(`loaded ${n} production env var from ${SERVICE} (in memory only)`);
}
if (!process.env.DATABASE_URL) usage('DATABASE_URL is not set (pass --prod-env)');

// Imported after the env is in place: db.js reads it at load time.
const { adminDecision, listAttention, safetyCounts } = await import('../api/_lib/content-safety-store.js');
const actor = `cli:${os.userInfo().username}`;

if (opts.approve) {
	const out = await adminDecision({ id: opts.approve, action: 'approve', note: safe(opts.note.trim(), 1000), actor });
	if (!out.ok) {
		console.error(`no model ${opts.approve}`);
		process.exit(1);
	}
	console.log(`approved ${opts.approve}: marked clear. A held model goes public on the next sweep; a blocked one stays private until its maker publishes it.`);
	process.exit(0);
}

const [items, counts] = await Promise.all([listAttention({ status: opts.status, limit: opts.limit }), safetyCounts()]);
const summary = Object.entries(counts)
	.map(([k, n]) => `${n} ${k}`)
	.join(', ');
console.log(`\nfinished public models by safety status: ${summary || 'none'}`);
console.log(`showing ${items.length} ${opts.status === 'attention' ? 'held or blocked' : opts.status} model(s), most recently screened first\n`);
if (!items.length) {
	console.log('Nothing to review.');
	process.exit(0);
}

for (const r of items) {
	const review = r.last_review || {};
	const hold = review.csam === true;
	console.log(`── ${r.id}  [${r.safety_status}${hold ? ', EVIDENCE HOLD' : ''}]  ${r.visibility || 'public'}`);
	console.log(`   model    https://three.ws/m/${r.id}`);
	if (r.prompt) console.log(`   prompt   ${JSON.stringify(safe(r.prompt, 240))}`);
	if (r.preview_image_url) console.log(`   preview  ${safe(r.preview_image_url)}`);
	console.log(
		`   verdict  ${safe(review.verdict || 'none', 40)}${review.categories?.length ? ` (${review.categories.map((c) => safe(c, 60)).join(', ')})` : ''}, screened ${iso(r.safety_checked_at)}`,
	);
	if (r.publish_requested_at) console.log(`   publish  requested ${iso(r.publish_requested_at)}`);
	if (hold) {
		console.log('   do not delete: CSAM evidence hold. Follow the CSAM runbook in docs/ops/content-safety.md.');
	} else {
		console.log(`   approve  npm run forge:safety -- --prod-env approve ${r.id} --note "<why it is fine>"`);
		console.log(`   remove   npm run forge:takedown -- ${r.id} --prod-env --apply --reason harmful --resolution "<why>"`);
	}
	console.log('');
}
