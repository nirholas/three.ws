#!/usr/bin/env node
/**
 * Forge funnel report: does a generation turn into an asset someone keeps?
 *
 * `npm run forge:errors` ranks what fails. This is the question after it: of the
 * meshes that came back, how many did a person accept or download, do new makers
 * return for a second one, what is each generation for, and which lane earns its
 * attempts. Same numbers as the owner board at /forge-funnel
 * (GET /api/ops/forge-funnel); both read api/_lib/forge-funnel.js, so the
 * definitions cannot drift.
 *
 * Usage:
 *   node scripts/forge-funnel-report.mjs              # last 30 days
 *   node scripts/forge-funnel-report.mjs --days 7
 *   node scripts/forge-funnel-report.mjs --json
 *
 * Reads DATABASE_URL from .env.local, then .env, then the shell (same order as
 * scripts/apply-migrations.mjs). Read-only: it runs SELECTs and nothing else.
 * Needs migration 20260921120000_forge_destination.sql applied.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

for (const envFile of ['.env.local', '.env']) {
	try {
		const raw = readFileSync(path.resolve(REPO_ROOT, envFile), 'utf8');
		for (const line of raw.split('\n')) {
			const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
			if (!m || process.env[m[1]]) continue;
			let val = m[2].trim();
			if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
				val = val.slice(1, -1);
			}
			process.env[m[1]] = val;
		}
	} catch { /* file not present */ }
}

const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const JSON_OUT = args.includes('--json');

if (!process.env.DATABASE_URL) {
	console.error('DATABASE_URL is not set. Add it to .env.local or export it in your shell.');
	console.error('Production\'s value: node scripts/read-service-env.mjs \'^DATABASE_URL$\' --raw');
	process.exit(2);
}

// Imported after the env files load: the db module resolves DATABASE_URL lazily,
// but env.js snapshots other vars at import time.
const { gatherForgeFunnel, clampFunnelDays } = await import('../api/_lib/forge-funnel.js');

const pct = (m) => (m?.value == null ? 'n/a' : `${(m.value * 100).toFixed(1)}%`);
const base = (m) => `${m?.n ?? 0}/${m?.of ?? 0}${m?.low_sample ? '  (low sample)' : ''}`;
const line = (label, m) => console.log(`  ${label.padEnd(30)} ${pct(m).padStart(7)}   ${base(m)}`);

function table(headers, rows) {
	const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
	const fmt = (r) => r.map((c, i) => (i === 0 ? String(c).padEnd(widths[i]) : String(c).padStart(widths[i]))).join('  ');
	console.log(`  ${fmt(headers)}`);
	console.log(`  ${widths.map((w) => '-'.repeat(w)).join('  ')}`);
	for (const r of rows) console.log(`  ${fmt(r)}`);
}

const report = await gatherForgeFunnel({ days: clampFunnelDays(flag('days', undefined)) });

if (JSON_OUT) {
	console.log(JSON.stringify(report, null, 2));
	process.exit(report.ok ? 0 : 1);
}

const { output: o, new_actors: a, retention: r, destinations: d, lanes, revenue: v } = report;

console.log(`\nForge funnel, last ${report.window_days} days  (rates under ${report.min_sample} rows are flagged low sample)\n`);

console.log('Output');
console.log(`  requests ${o.requests}   done ${o.done}   failed ${o.failed}   in flight ${o.in_flight}   keyless (left out of per-maker metrics) ${o.unattributed_requests}`);
line('Generation success', o.generation_success_rate);
line('Useful output (kept or downloaded)', o.useful_output_rate);
line('Feedback coverage', o.feedback_coverage);
console.log(`  accepted ${o.accepted}   rejected ${o.rejected}   downloaded ${o.downloaded}   rated ${o.rated}   avg rating ${o.avg_rating ?? 'n/a'}`);

console.log(`\nNew makers (first-ever creation inside the window): ${a.new_actors}`);
line('First asset success', a.first_asset_success_rate);
line('Reached any finished asset', a.reached_any_asset_rate);
line('Second asset', a.second_asset_rate);

console.log(`\nRetention (makers first seen in the last ${r.cohort_lookback_days} days)`);
line('Came back after day 7', r.d7);
line('Came back after day 30', r.d30);

console.log('\nWhat it was for');
line('Answered', d.answer_rate);
table(
	['destination', 'done', 'useful', 'downloaded', 'useful rate'],
	d.rows.map((x) => [x.label, x.done, x.useful, x.downloaded, pct(x.useful_output_rate)]),
);

console.log('\nLanes (failed-over attempts included: an attempt a lane lost is what this measures)');
if (lanes.length) {
	table(
		['backend', 'class', 'attempts', 'done', 'useful', 'success', 'useful rate', 'attempts/useful', 'avg s', 's/useful'],
		lanes.map((l) => [
			l.backend, l.cost_class, l.attempts, l.done, l.useful,
			pct(l.generation_success_rate), pct(l.useful_output_rate),
			l.attempts_per_useful ?? 'n/a', l.avg_generation_seconds ?? 'n/a', l.generation_seconds_per_useful ?? 'n/a',
		]),
	);
} else {
	console.log('  no terminal attempts in this window');
}

console.log(`\nRevenue (${v.rail} only: the one rail whose price is recorded on the row)`);
console.log(`  paid generations ${v.paid_generations}   distinct payers ${v.distinct_payers}   USDC ${v.usdc.toFixed(2)}   USDC per useful asset ${v.usdc_per_useful_asset ?? 'n/a'}`);
line('Paying agents back next week', v.agent_weekly_retention);

if (!report.ok) {
	console.log('\nDegraded panels:');
	for (const g of report.degraded) console.log(`  ${g.panel}: ${g.error}`);
	process.exit(1);
}
console.log('');
