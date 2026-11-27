#!/usr/bin/env node
/**
 * Forge generation error report: what failed after a job existed, ranked by the
 * requests it cost, with the change against the previous window.
 *
 * /api/healthz answers "is generation healthy right now?" over a fixed 6-hour
 * window. Triage needs the other question: over the last week, which cause
 * recurs most, on which lane and step, and is it getting better or worse? This
 * is that query as a command, so nobody hand-writes it against production.
 *
 * It counts exactly what `npm run forge:funnel` and /forge-funnel count (one
 * definition, printed at the top, in api/_lib/forge-operator-report.js), so the
 * two reports give the same success rate for the same window.
 *
 * Usage:
 *   npm run forge:errors                          # last 7 days
 *   npm run forge:errors -- --days 30
 *   npm run forge:errors -- --class bad_input_image   # every detail of one cause
 *   npm run forge:errors -- --include-recovered   # also rank attempts that failed over
 *   npm run forge:errors -- --include-internal    # count catalog-seeder and benchmark rows too
 *   npm run forge:errors -- --reveal              # show full messages and prompts
 *   npm run forge:errors -- --json
 *
 * Exit status: 0 printed, 1 the --class asked for is not in the window,
 * 2 DATABASE_URL is not set, 3 the database did not answer.
 *
 * Reads DATABASE_URL from .env.local, then .env, then the shell. Read-only.
 *
 * Every run also prints the requests that ended BEFORE a job existed (a limiter,
 * the reference image, a lane refusing the submit), by stage and cause, and the
 * end-to-end success rate beside the lane rate. Those never create a row, so the
 * SQL cannot see them; see scripts/lib/forge-prejob-report.mjs.
 */

import { loadRepoEnv, flagValue } from './lib/forge-report-cli.mjs';
import { loadPreJobBreakdown, printPreJobSection } from './lib/forge-prejob-report.mjs';

loadRepoEnv();

const args = process.argv.slice(2);
const DAYS = Math.max(1, Math.min(365, Math.trunc(Number(flagValue(args, 'days', '7'))) || 7));
const JSON_OUT = args.includes('--json');
const ONLY_CLASS = flagValue(args, 'class', null);
const INCLUDE_RECOVERED = args.includes('--include-recovered');
const INCLUDE_INTERNAL = args.includes('--include-internal');
const REVEAL = args.includes('--reveal');

const lib = await import('../api/_lib/forge-operator-report.js');

if (!process.env.DATABASE_URL) {
	console.error(lib.missingDatabaseMessage('npm run forge:errors'));
	process.exit(lib.EXIT_CODES.missing_database);
}

// Started first, read last: the counter read runs while the SQL does.
const preJobLoad = loadPreJobBreakdown();

let raw;
try {
	raw = await lib.gatherForgeErrors({
		days: DAYS,
		includeRecovered: INCLUDE_RECOVERED,
		includeInternal: INCLUDE_INTERNAL,
		reveal: REVEAL,
	});
} catch (err) {
	console.error(lib.unreachableDatabaseMessage(err, process.env.DATABASE_URL));
	process.exit(lib.EXIT_CODES.unreachable_database);
}

const report = lib.summarizeForgeErrors(raw);
const preJob = await preJobLoad;
const endToEnd = preJob.pre_job?.last_24h?.end_to_end_success_rate ?? null;

if (JSON_OUT) {
	console.log(JSON.stringify({ database: lib.databaseHost(process.env.DATABASE_URL), ...report, preJob, endToEndSuccessRate24h: endToEnd }, null, 2));
} else if (ONLY_CLASS) {
	const text = lib.formatErrorClass(report, ONLY_CLASS);
	if (text) {
		console.log(text);
	} else {
		const present = [...new Set(report.causes.map((c) => c.id))];
		console.error(`No class "${ONLY_CLASS}" in the last ${DAYS} day(s). Present: ${present.join(', ') || 'none'}`);
		process.exitCode = 1;
	}
} else {
	console.log(lib.formatErrorReport(report, { database: process.env.DATABASE_URL }));
	console.log(`\n  end-to-end success, last 24h ${endToEnd == null ? 'n/a' : `${(endToEnd * 100).toFixed(1)}%`} (every request accepted past sign-in, including the ones that never became a job)`);
	printPreJobSection(preJob);
}
