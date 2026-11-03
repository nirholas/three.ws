#!/usr/bin/env node
// Read-only failure distribution for the x402 autonomous loop and ring tick.
// Usage: node scripts/x402-loop-failure-report.mjs [--hours 48] [--days 7]
// DATABASE_URL comes from the environment, else .env.local, else the live
// Cloud Run service via scripts/read-service-env.mjs. Only SELECTs are issued.
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { neon } from '@neondatabase/serverless';

function arg(name, fallback) {
	const i = process.argv.indexOf(`--${name}`);
	return i > 0 ? Number(process.argv[i + 1]) : fallback;
}

function resolveDatabaseUrl() {
	if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
	if (existsSync('.env.local')) {
		const m = readFileSync('.env.local', 'utf8').match(/^DATABASE_URL=(.+)$/m);
		if (m) return m[1].trim().replace(/^["']|["']$/g, '');
	}
	const out = execFileSync('node', ['scripts/read-service-env.mjs', '^DATABASE_URL$', '--raw'], {
		encoding: 'utf8',
	});
	const line = out.split('\n').find((l) => l.includes('postgres'));
	if (!line) throw new Error('DATABASE_URL did not resolve from the Cloud Run service');
	return line.slice(line.indexOf('postgres')).trim();
}

const hours = arg('hours', 48);
const days = arg('days', 7);
const sql = neon(resolveDatabaseUrl());

const print = (title, rows) => {
	console.log(`\n## ${title}`);
	console.table(rows);
};

print(
	`Outcomes, last ${hours}h`,
	await sql`select case when success then 'ok' else coalesce(error_msg,'failed') end as outcome, count(*)::int as n,
		round(100.0 * count(*) / sum(count(*)) over (), 2)::float as pct
		from x402_autonomous_log where ts > now() - make_interval(hours => ${hours}) group by 1 order by 2 desc limit 30`,
);
print(
	`Worst services, last ${hours}h`,
	await sql`select service_name, count(*) filter (where success)::int as ok, count(*)::int as total
		from x402_autonomous_log where ts > now() - make_interval(hours => ${hours})
		group by 1 order by (count(*) - count(*) filter (where success)) desc limit 25`,
);
print(
	`Pipelines, last ${days}d`,
	await sql`select pipeline, count(*) filter (where success)::int as ok, count(*)::int as total
		from x402_autonomous_log where ts > now() - make_interval(days => ${days}) group by 1`,
);
print(
	`Ring Tick, last ${days}d`,
	await sql`select coalesce(error_msg,'ok') as outcome, count(*)::int as n
		from x402_autonomous_log where service_name ilike '%ring tick%' and ts > now() - make_interval(days => ${days})
		group by 1 order by 2 desc`,
);
print(
	'Hourly failures, last 24h',
	await sql`select date_trunc('hour', ts) as hour, count(*) filter (where not success)::int as failed, count(*)::int as total
		from x402_autonomous_log where ts > now() - interval '24 hours' group by 1 order by 1`,
);
