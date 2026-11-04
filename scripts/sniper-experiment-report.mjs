// Read-only sniper experiment report: per arm, realized P&L, model-call cost,
// net P&L, and the trailing-stop giveback (peak vs exit value).
//
//   node scripts/sniper-experiment-report.mjs [--days 7] [--network mainnet] [--sol-usd 150]
//
// Runs only SELECTs. Judge cost comes from sniper_llm_verdicts rows written
// after the 20261105100000 migration; older verdicts are counted as unpriced
// and are not estimated. SOL/USD defaults to the live spot price.

import './lib/gcloud-path.mjs';
import { createRequire } from 'node:module';
import { requireServiceEnvValue } from './lib/service-env.mjs';
import { summarizeArm } from '../workers/agent-sniper/experiment-report.js';
import { solPriceUsd } from '../api/_lib/sol-price.js';

const require = createRequire(import.meta.url);
const { Pool } = require('@neondatabase/serverless');

function flag(name, def) {
	const i = process.argv.indexOf(name);
	return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const days = Math.max(1, Math.min(90, Number(flag('--days', 7)) || 7));
const network = flag('--network', 'mainnet');
const solUsd = Number(flag('--sol-usd', 0)) || (await solPriceUsd());

const pool = new Pool({ connectionString: process.env.DATABASE_URL || requireServiceEnvValue('DATABASE_URL') });
const { rows: positions } = await pool.query(
	`select coalesce(s.experiment_group, s.label, 'unlabeled') as arm, s.llm_model,
	        p.exit_reason, p.realized_pnl_lamports, p.peak_value_lamports, p.exit_quote_lamports
	   from agent_sniper_positions p
	   join agent_sniper_strategies s on s.id = p.strategy_id
	  where p.network = $1 and p.status = 'closed' and p.buy_sig <> 'SIMULATED'
	    and p.opened_at > now() - ($2 || ' days')::interval`,
	[network, String(days)],
);
const { rows: colRows } = await pool.query(
	`select 1 from information_schema.columns where table_name = 'sniper_llm_verdicts' and column_name = 'cost_usd'`,
);
const priced = colRows.length > 0;
const { rows: costs } = await pool.query(
	priced
		? `select model, count(*) filter (where cost_usd is not null) as priced,
	        count(*) filter (where cost_usd is null) as unpriced,
	        coalesce(sum(cost_usd), 0) as cost_usd
	   from sniper_llm_verdicts
	  where network = $1 and created_at > now() - ($2 || ' days')::interval
	  group by model`
		: `select model, 0 as priced, count(*) as unpriced, 0 as cost_usd
	   from sniper_llm_verdicts
	  where network = $1 and created_at > now() - ($2 || ' days')::interval
	  group by model`,
	[network, String(days)],
);
await pool.end();

const costByModel = new Map(costs.map((c) => [c.model, c]));
const byArm = new Map();
for (const p of positions) {
	if (!byArm.has(p.arm)) byArm.set(p.arm, { model: p.llm_model, rows: [] });
	byArm.get(p.arm).rows.push(p);
}

const pct = (v) => (v == null ? '-' : `${(v * 100).toFixed(1)}%`);
const usd = (v) => (v == null ? '-' : `$${v.toFixed(2)}`);
console.log(`Experiment report, ${network}, last ${days} days, SOL/USD ${solUsd.toFixed(2)}, ${positions.length} closed live trades\n`);
for (const [arm, { model, rows }] of [...byArm.entries()].sort()) {
	const c = model ? costByModel.get(model) : null;
	const s = summarizeArm({
		positions: rows,
		judgeCostUsd: Number(c?.cost_usd ?? 0),
		verdictsPriced: Number(c?.priced ?? 0),
		verdictsUnpriced: Number(c?.unpriced ?? 0),
		solUsd,
	});
	console.log(`${arm}${model ? `  [${model}]` : ''}`);
	console.log(`  closed ${s.closed}  pnl ${s.pnlSol.toFixed(4)} SOL (${usd(s.pnlUsd)})  judge cost ${usd(s.judgeCostUsd)} (${s.verdictsPriced} priced, ${s.verdictsUnpriced} unpriced)  net ${usd(s.netUsd)}`);
	console.log(`  trailing stops ${s.trailingStops}  pnl ${s.trailingPnlSol.toFixed(4)} SOL  median giveback ${pct(s.medianGiveback)}`);
}
if (!priced) console.log('\nsniper_llm_verdicts.cost_usd does not exist yet: apply migration 20261105100000 to start pricing verdicts. Net P&L above excludes model cost.');
if (!positions.length) console.log('No closed live trades in this window.');
