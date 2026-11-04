// Read-only sniper entry latency report.
//
//   node scripts/sniper-latency-report.mjs [--days 7] [--network mainnet]
//
// Reads the four stage stamps the executor writes on every live entry
// (signal_seen_at, decision_at, sent_at, landed_at) and prints p50 / p90 per
// stage per experiment arm. Runs only SELECTs. Rows without a stamp (paper
// fills, entries before the 20261105080000 migration) are skipped per stage.

import './lib/gcloud-path.mjs';
import { createRequire } from 'node:module';
import { requireServiceEnvValue } from './lib/service-env.mjs';
import { stageLatencies, percentile } from '../workers/agent-sniper/telemetry.js';

const require = createRequire(import.meta.url);
const { Pool } = require('@neondatabase/serverless');

function flag(name, def) {
	const i = process.argv.indexOf(name);
	return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const days = Math.max(1, Math.min(90, Number(flag('--days', 7)) || 7));
const network = flag('--network', 'mainnet');

const pool = new Pool({ connectionString: process.env.DATABASE_URL || requireServiceEnvValue('DATABASE_URL') });
const { rows } = await pool.query(
	`select coalesce(s.experiment_group, s.label, 'unlabeled') as arm,
	        p.exec_route, p.signal_seen_at, p.decision_at, p.sent_at, p.landed_at
	   from agent_sniper_positions p
	   left join agent_sniper_strategies s on s.id = p.strategy_id
	  where p.network = $1 and p.opened_at > now() - ($2 || ' days')::interval
	    and p.sent_at is not null`,
	[network, String(days)],
);
await pool.end();

const byArm = new Map();
for (const r of rows) {
	const key = `${r.arm} / ${r.exec_route || 'unknown'}`;
	if (!byArm.has(key)) byArm.set(key, []);
	byArm.get(key).push(stageLatencies(r));
}

const stages = ['signal_to_decision', 'decision_to_sent', 'sent_to_landed', 'total'];
const fmt = (v) => (v == null ? '-' : `${Math.round(v)}ms`);
console.log(`Entry latency, ${network}, last ${days} days, ${rows.length} live entries\n`);
if (!rows.length) console.log('No stamped live entries in this window. Entries are stamped from the first live buy after the migration is applied.');
for (const [key, list] of [...byArm.entries()].sort()) {
	console.log(`${key}  (n=${list.length})`);
	for (const st of stages) {
		const vals = list.map((x) => x[st]).filter((v) => v != null);
		console.log(`  ${st.padEnd(20)} p50 ${fmt(percentile(vals, 50)).padStart(8)}  p90 ${fmt(percentile(vals, 90)).padStart(8)}  n=${vals.length}`);
	}
}
