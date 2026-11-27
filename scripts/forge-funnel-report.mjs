#!/usr/bin/env node
/**
 * Forge funnel report: does a request turn into an asset someone keeps?
 *
 * `npm run forge:errors` ranks what fails after a job exists. This is the
 * question around it: how many requests finished, how many a person accepted or
 * downloaded, whether new makers come back, what each generation is for, and
 * which lane loses requests. Same numbers as the owner board at /forge-funnel
 * (GET /api/ops/forge-funnel) and the same success definition as forge:errors;
 * all three read api/_lib/forge-funnel.js and api/_lib/forge-operator-report.js.
 *
 * Requests refused before a job existed are not in forge_creations. The report
 * says so at the top, and --requests reads the one record that has them, the
 * Cloud Run request log (needs a gcloud login that can read the serving project;
 * GCP_PROJECT and GCP_ACCOUNT pick which).
 *
 * Usage:
 *   npm run forge:funnel                       # last 30 days
 *   npm run forge:funnel -- --days 7
 *   npm run forge:funnel -- --days 7 --requests
 *   npm run forge:funnel -- --json
 *
 * Exit status: 0 printed, 1 some panels could not be read (named at the end),
 * 2 DATABASE_URL is not set, 3 the database did not answer at all.
 *
 * Reads DATABASE_URL from .env.local, then .env, then the shell. Read-only.
 */

import { loadRepoEnv, flagValue, readForgeRequestLog } from './lib/forge-report-cli.mjs';

loadRepoEnv();

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const WITH_REQUESTS = args.includes('--requests');

// Imported after the env files load: env.js snapshots some vars at import time.
const lib = await import('../api/_lib/forge-operator-report.js');
const { gatherForgeFunnel, clampFunnelDays } = await import('../api/_lib/forge-funnel.js');

if (!process.env.DATABASE_URL) {
	console.error(lib.missingDatabaseMessage('npm run forge:funnel'));
	process.exit(lib.EXIT_CODES.missing_database);
}

const report = await gatherForgeFunnel({ days: clampFunnelDays(flagValue(args, 'days', undefined)) });

if (report.unreachable) {
	console.error(lib.unreachableDatabaseMessage(report.degraded[0]?.error, process.env.DATABASE_URL));
	process.exit(lib.EXIT_CODES.unreachable_database);
}

let requestLog = null;
if (WITH_REQUESTS) {
	const read = readForgeRequestLog({ days: report.window_days });
	requestLog = read.ok
		? { ok: true, project: read.project, summary: lib.summarizeRequestLog(lib.parseRequestLogLines(read.text), { truncated: read.truncated }) }
		: { ok: false, project: read.project, error: read.error };
}

if (JSON_OUT) {
	const body = requestLog
		? {
			...report,
			request_log: requestLog,
			top_problems: lib.funnelTopProblems(report.lanes, report.previous.lanes, requestLog.ok ? requestLog.summary : null),
		}
		: report;
	console.log(JSON.stringify(body, null, 2));
} else {
	console.log(lib.formatFunnelReport(report, { requestLog }));
}
process.exitCode = report.ok ? lib.EXIT_CODES.ok : lib.EXIT_CODES.degraded;
