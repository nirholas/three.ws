#!/usr/bin/env node
// Review the Forge removal-request queue from a workstation.
//
// Requests come from "Request removal" on any model page (POST
// /api/forge-removal-request). There is deliberately no admin page or admin
// HTTP endpoint for them: an operator reviews here, with their own gcloud login,
// so the public server exposes nothing that can delete a model on request.
//
//   npm run forge:removals -- --prod-env                       open requests
//   npm run forge:removals -- --prod-env --status all          every request
//   npm run forge:removals -- --prod-env --limit 200
//   npm run forge:removals -- --prod-env dismiss <request-id> --resolution "<why>"
//
// To remove a model, run the takedown command printed under its request. It
// deletes everything and closes every open request on that model.
//
// --prod-env  read DATABASE_URL from the three-ws-api Cloud Run service into
//             this process only (scripts/lib/cloud-run-env.mjs); nothing is
//             written to disk. Without it the script uses its own environment.
//
// Request text was written by anyone on the internet. It is printed as data
// and never acted on.
//
// Exit codes: 0 ok; 1 the dismiss found no open request; 2 usage error.

import os from 'node:os';
import { SERVICE, loadCloudRunEnv } from './lib/cloud-run-env.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ['open', 'removed', 'dismissed', 'all'];

function usage(msg) {
	if (msg) console.error(`forge-removals: ${msg}`);
	console.error('Usage: npm run forge:removals -- [--prod-env] [--status open|removed|dismissed|all] [--limit N]');
	console.error('       npm run forge:removals -- [--prod-env] dismiss <request-id> --resolution "<why>"');
	process.exit(2);
}

function parseArgs(argv) {
	const out = { prodEnv: false, status: 'open', limit: 50, dismiss: null, resolution: null };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		const next = () => (i + 1 < argv.length ? argv[++i] : usage(`${a} needs a value`));
		if (a === '--prod-env') out.prodEnv = true;
		else if (a === '--status') out.status = next();
		else if (a === '--limit') out.limit = Number(next());
		else if (a === '--resolution') out.resolution = next();
		else if (a === 'dismiss') out.dismiss = next();
		else usage(`unknown argument ${a}`);
	}
	if (!STATUSES.includes(out.status)) usage(`--status must be one of ${STATUSES.join(', ')}`);
	if (!Number.isInteger(out.limit) || out.limit < 1 || out.limit > 200) usage('--limit must be 1 to 200');
	if (out.dismiss !== null) {
		if (!UUID.test(out.dismiss)) usage('dismiss needs a removal request id (a uuid)');
		if (!out.resolution?.trim()) usage('dismiss needs --resolution "<why it stays up>"');
	}
	return out;
}

// Request text is untrusted: strip control characters (terminal escapes
// included) before it reaches the operator's screen.
function safe(text, max = 2000) {
	return String(text ?? '')
		.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')
		.slice(0, max);
}

function shellQuote(s) {
	return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

const opts = parseArgs(process.argv.slice(2));
if (opts.prodEnv) {
	const n = loadCloudRunEnv({ wanted: /^DATABASE_URL$/, required: ['DATABASE_URL'] });
	console.log(`loaded ${n} production env var from ${SERVICE} (in memory only)`);
}
if (!process.env.DATABASE_URL) usage('DATABASE_URL is not set (pass --prod-env)');

// Imported after the env is in place: db.js reads it at load time.
const { listRemovalRequests, removalRequestCounts, dismissRemovalRequest, reasonTitle } = await import('../api/_lib/forge-removal-requests.js');
const reviewer = `cli:${os.userInfo().username}`;

if (opts.dismiss) {
	const row = await dismissRemovalRequest({ id: opts.dismiss, resolution: safe(opts.resolution.trim(), 1000), reviewedBy: reviewer });
	if (!row) {
		console.error(`no open removal request ${opts.dismiss} (already closed, or a wrong id)`);
		process.exit(1);
	}
	console.log(`dismissed ${row.id} for model ${row.creation_id}; the model stays up.`);
	process.exit(0);
}

const [requests, counts] = await Promise.all([listRemovalRequests({ status: opts.status, limit: opts.limit }), removalRequestCounts()]);
console.log(`\nremoval requests: ${counts.open} open, ${counts.removed} removed, ${counts.dismissed} dismissed`);
console.log(`showing ${requests.length} ${opts.status === 'all' ? '' : `${opts.status} `}request(s), newest first\n`);
if (!requests.length) {
	console.log(opts.status === 'open' ? 'Nothing to review.' : 'No requests match.');
	process.exit(0);
}

for (const r of requests) {
	const model = r.creation_exists
		? `${r.visibility || 'public'}, ${r.creation_status}${r.prompt ? `, prompt "${safe(r.prompt, 160)}"` : ''}`
		: 'already gone';
	console.log(`── ${r.id}  [${r.status}]  ${new Date(r.created_at).toISOString()}`);
	console.log(`   reason   ${reasonTitle(r.reason)}`);
	console.log(`   model    https://three.ws/m/${r.creation_id}  (${model})`);
	if (r.preview_image_url) console.log(`   preview  ${safe(r.preview_image_url, 400)}`);
	if (r.details) console.log(`   details  ${safe(r.details).replace(/\n/g, '\n            ')}`);
	if (r.contact) console.log(`   contact  ${safe(r.contact, 200)}`);
	if (r.reporter_user_id) console.log(`   account  ${r.reporter_user_id}`);
	if (r.status !== 'open') {
		console.log(`   closed   by ${safe(r.reviewed_by, 120)}: ${safe(r.resolution, 1000)}`);
	} else {
		if (r.creation_exists) {
			console.log(
				`   remove   npm run forge:takedown -- ${r.creation_id} --prod-env --apply --reason ${r.reason} --resolution "<why>"`,
			);
		}
		console.log(`   dismiss  npm run forge:removals -- --prod-env dismiss ${r.id} --resolution ${shellQuote('<why it stays up>')}`);
	}
	console.log('');
}
