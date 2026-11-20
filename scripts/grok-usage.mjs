#!/usr/bin/env node
// Operator CLI for the xAI credit ledger. No admin page exists on purpose; this
// reads production with the operator's own gcloud login.
//
//   npm run grok:usage -- --prod-env             spend by lane and model, burn, credit
//   npm run grok:usage -- --prod-env --reconcile compare the ledger to xAI's billing
//   npm run grok:usage                           same, against DATABASE_URL in .env
//
// --prod-env   read DATABASE_URL and the XAI_* grant vars from the three-ws-api
//              Cloud Run service into this process only.
// --reconcile  POST management-api.x.ai /v1/billing/teams/{team_id}/usage for the
//              last 30 days and print the drift. Needs XAI_MANAGEMENT_KEY and
//              XAI_TEAM_ID (a management key from the xAI console).
//
// Exit codes: 0 ok; 1 failed; 2 usage error.

import { loadCloudRunEnv } from './lib/cloud-run-env.mjs';

const args = process.argv.slice(2);
const known = new Set(['--prod-env', '--reconcile']);
const bad = args.find((a) => !known.has(a));
if (bad) {
	console.error(`grok-usage: unknown argument ${bad}\nUsage: npm run grok:usage -- [--prod-env] [--reconcile]`);
	process.exit(2);
}
const prodEnv = args.includes('--prod-env');
const wantReconcile = args.includes('--reconcile');

if (prodEnv) {
	loadCloudRunEnv({
		wanted: /^(DATABASE_URL|XAI_(CREDIT_.*|DAILY_SPEND_CAP_USD|MANAGEMENT_KEY|TEAM_ID))$/,
		required: ['DATABASE_URL'],
	});
}

const { sql } = await import('../api/_lib/db.js');
const { buildReport, formatReport, managementUsageRequest, sumManagementUsd, reconcile } = await import('./lib/xai-usage-report.mjs');

let code = 0;
try {
	const report = await buildReport(sql);
	console.log(formatReport(report));
	if (wantReconcile) {
		const key = process.env.XAI_MANAGEMENT_KEY;
		const team = process.env.XAI_TEAM_ID;
		if (!key || !team) {
			console.error('reconcile: set XAI_MANAGEMENT_KEY (a management key from the xAI console) and XAI_TEAM_ID on Cloud Run, then rerun with --prod-env.');
			code = 1;
		} else {
			const to = new Date();
			const from = new Date(to.getTime() - 30 * 86_400_000);
			const res = await fetch(`https://management-api.x.ai/v1/billing/teams/${encodeURIComponent(team)}/usage`, {
				method: 'POST',
				headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
				body: JSON.stringify(managementUsageRequest(from, to)),
			});
			if (!res.ok) {
				console.error(`reconcile: management API answered HTTP ${res.status}. The management key needs read access to billing.`);
				code = 1;
			} else {
				const r = reconcile(report.windows[2].totalMicro / 1e6, sumManagementUsd(await res.json()));
				const pct = r.driftPct === null ? '' : ` (${r.driftPct.toFixed(1)}%)`;
				console.log(`reconcile (30 days): ledger ${r.ledgerUsd.toFixed(2)} USD, xAI ${r.xaiUsd.toFixed(2)} USD, drift ${r.driftUsd.toFixed(2)} USD${pct}`);
				if (r.looksLikeCents) console.log('reconcile: xAI reports about 100x our figure; its usd series may be in cents. Divide by 100 before trusting the drift.');
			}
		}
	}
} catch (err) {
	console.error(`grok-usage: ${err.message}`);
	code = 1;
}
process.exit(code);
