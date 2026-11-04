// Read-only first-party campaign report, joined to marketing/growth/campaigns.csv.
//
//   node scripts/campaign-report.mjs [--from 2026-11-01] [--to 2026-11-30]
//
// Prints touches and signup / agent_created / forge_generation / paid_call
// conversions per campaign. Runs only SELECTs.

import './lib/gcloud-path.mjs';
import { createRequire } from 'node:module';
import { requireServiceEnvValue } from './lib/service-env.mjs';
import { readCampaigns } from './lib/campaigns-csv.mjs';
import { CONVERSION_EVENTS } from '../public/campaign-attribution.js';

const require = createRequire(import.meta.url);
const { Pool } = require('@neondatabase/serverless');

function flag(name, def) {
	const i = process.argv.indexOf(name);
	return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const day = (d) => d.toISOString().slice(0, 10);
const from = flag('--from', day(new Date(Date.now() - 30 * 86_400_000)));
const to = flag('--to', day(new Date(Date.now() + 86_400_000)));

const pool = new Pool({ connectionString: process.env.DATABASE_URL || requireServiceEnvValue('DATABASE_URL') });
const ledger = await pool.query(
	`select to_regclass('campaign_touches') is not null as ready`,
);
if (!ledger.rows[0].ready) {
	console.log('campaign_touches does not exist yet: apply migration 20261105110000_campaign_attribution_ledger.sql (npm run db:status, then db:migrate).');
	await pool.end();
	process.exit(0);
}
const { rows: touches } = await pool.query(
	`select campaign, count(*)::int as touches from campaign_touches
	  where created_at >= $1 and created_at < $2 group by campaign`,
	[from, to],
);
const { rows: conv } = await pool.query(
	`select t.campaign, c.event, count(*)::int as n
	   from campaign_conversions c join campaign_touches t on t.id = c.touch_id
	  where t.created_at >= $1 and t.created_at < $2 group by t.campaign, c.event`,
	[from, to],
);
await pool.end();

const csv = readCampaigns();
const csvIds = new Set(csv.map((c) => c.campaign_id.toLowerCase()));
const t = new Map(touches.map((r) => [r.campaign, r.touches]));
const c = new Map(conv.map((r) => [`${r.campaign}|${r.event}`, r.n]));
const ids = [...new Set([...csv.map((r) => r.campaign_id.toLowerCase()), ...t.keys()])];

console.log(`Campaign attribution ${from} to ${to}\n`);
if (!touches.length) {
	const first = csv[0]?.campaign_id.toLowerCase() || 'mkt-2026-11-gcp-agent';
	console.log(`No touches yet. Open a tagged link in a browser to record the first one:\n  node scripts/campaign-link.mjs ${first} https://three.ws/forge --source test\n`);
}
const pad = (v, n) => String(v).padEnd(n);
console.log(pad('campaign', 34) + pad('touches', 9) + CONVERSION_EVENTS.map((e) => pad(e, 18)).join('') + 'in csv');
for (const id of ids) {
	console.log(pad(id, 34) + pad(t.get(id) ?? 0, 9) + CONVERSION_EVENTS.map((e) => pad(c.get(`${id}|${e}`) ?? 0, 18)).join('') + (csvIds.has(id) ? 'yes' : 'NO'));
}
