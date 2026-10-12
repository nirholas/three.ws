#!/usr/bin/env node
/**
 * Tripo-lane report: completion rate and median latency by day, scoped to
 * backend = 'tripo' (work order 084-partners-01-tripo-v3-house-lane.md,
 * task 6). `npm run forge:funnel` answers the all-backend product question;
 * this answers the narrower one the house-key decision needs: is the lane
 * actually finishing jobs, and how fast.
 *
 * Usage:
 *   node scripts/tripo-lane-report.mjs              # last 30 days
 *   node scripts/tripo-lane-report.mjs --days 7
 *   node scripts/tripo-lane-report.mjs --json
 *
 * Reads DATABASE_URL from .env.local, then .env, then the shell (same order as
 * scripts/apply-migrations.mjs). Read-only: it runs SELECTs and nothing else.
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

const { gatherTripoLaneReport } = await import('../api/_lib/tripo-lane-report.js');

const report = await gatherTripoLaneReport({ days: flag('days', undefined) });

if (JSON_OUT) {
	console.log(JSON.stringify(report, null, 2));
	process.exit(report.ok ? 0 : 1);
}

if (!report.ok) {
	console.error(`Tripo lane report failed: ${report.error}`);
	process.exit(1);
}

const pct = (v) => (v == null ? 'n/a' : `${(v * 100).toFixed(1)}%`);
const secs = (v) => (v == null ? 'n/a' : `${v}s`);

console.log(`\nTripo lane, last ${report.window_days} days`);
console.log(`  total ${report.total}   done ${report.done}   failed ${report.failed}`);
console.log(`  completion rate ${pct(report.completion_rate)}   median latency ${secs(report.median_latency_seconds)}\n`);

if (!report.by_day.length) {
	console.log('  no Tripo-lane jobs in this window\n');
	process.exit(0);
}

const headers = ['day', 'total', 'done', 'failed', 'in flight', 'completion', 'median s'];
const rows = report.by_day.map((d) => [
	d.day,
	d.total,
	d.done,
	d.failed,
	d.in_flight,
	pct(d.completion_rate),
	secs(d.median_latency_seconds),
]);
const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
const fmt = (r) => r.map((c, i) => (i === 0 ? String(c).padEnd(widths[i]) : String(c).padStart(widths[i]))).join('  ');
console.log(`  ${fmt(headers)}`);
console.log(`  ${widths.map((w) => '-'.repeat(w)).join('  ')}`);
for (const r of rows) console.log(`  ${fmt(r)}`);
console.log('');
