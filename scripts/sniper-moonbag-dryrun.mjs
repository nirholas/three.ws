#!/usr/bin/env node
// Read-only preview of one moon-bag manager sweep against production.
//
// Lists the real retained bags, re-quotes each with the worker's own quote path
// (curve, then AMM once graduated) and runs the real decision function, but every
// side effect is swapped for a log line: no database write, no price tick, no sell,
// no transaction. Use it before rolling the agent-sniper service to see what the
// manager would do to the bags sitting in the wallets.
//
//   node scripts/sniper-moonbag-dryrun.mjs [--limit 25]
//
// Env comes from the local shell first, then the agent-sniper Cloud Run service,
// then three-ws-api.

import './lib/gcloud-path.mjs';
import { serviceEnvValue } from './lib/service-env.mjs';

function flag(name, def) {
	const i = process.argv.indexOf(name);
	return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

for (const key of ['DATABASE_URL', 'SOLANA_RPC_URL', 'HELIUS_API_KEY', 'JWT_SECRET']) {
	if (process.env[key]) continue;
	const value = serviceEnvValue(key, { service: 'agent-sniper' }) || serviceEnvValue(key);
	if (value) process.env[key] = value;
}
process.env.SNIPER_MODE = 'simulate';

const { loadConfig } = await import('../workers/agent-sniper/config.js');
const { runMoonbagSweep, defaultDeps } = await import('../workers/agent-sniper/moonbag-manager.js');

const cfg = loadConfig();
cfg.moonbagBatch = Math.max(1, Math.min(500, Number(flag('--limit', 25)) || 25));

const real = defaultDeps(cfg);
const quotes = [];
const actions = [];
const deps = {
	...real,
	store: {
		listBags: real.store.listBags,
		async saveQuote(id, q) {
			quotes.push({ id, value: q.moonbag_last_value_lamports, peak: q.moonbag_peak_value_lamports, stale: q.moonbag_stale_since });
		},
		async writeOff(id, reason) {
			actions.push({ id, action: 'write_off', reason });
		},
	},
	async sell(bag, reason) {
		actions.push({ id: bag.id, action: 'sell', reason });
	},
	async recordTick() {},
};

let bags;
try {
	bags = await real.store.listBags(cfg.network, cfg.moonbagBatch);
} catch (err) {
	console.error(`Could not list moon bags: ${err?.message}. Check DATABASE_URL and gcloud auth.`);
	process.exit(1);
}
if (!bags.length) {
	console.log(`No open moon bags on ${cfg.network}. The manager has nothing to sweep.`);
	process.exit(0);
}

const summary = await runMoonbagSweep(cfg, { ...deps, store: { ...deps.store, listBags: async () => bags } });
const byId = new Map(bags.map((b) => [b.id, b]));
const actionById = new Map(actions.map((a) => [a.id, a]));

console.log(`Moon-bag dry run, ${cfg.network}, ${bags.length} bag(s), trail ${cfg.moonbag.trailPct}%, nothing written or sent\n`);
console.log('mint        entry_lamports  value_lamports  peak_lamports  decision');
for (const q of quotes) {
	const bag = byId.get(q.id);
	const act = actionById.get(q.id);
	const decision = act ? `${act.action} (${act.reason})` : q.stale ? `hold (stale since ${q.stale})` : 'hold';
	console.log(
		`${String(bag.mint).slice(0, 10).padEnd(12)}${String(bag.moonbag_entry_lamports ?? '').padStart(14)}  ${String(q.value).padStart(14)}  ${String(q.peak).padStart(13)}  ${decision}`,
	);
}
const unquoted = bags.length - quotes.length;
if (unquoted) console.log(`\n${unquoted} bag(s) could not be quoted this pass (transient RPC failure); the live sweep retries them.`);
console.log(`\nWould quote ${summary.quoted}, sell ${summary.sold}, write off ${summary.writtenOff}.`);
process.exit(0);
