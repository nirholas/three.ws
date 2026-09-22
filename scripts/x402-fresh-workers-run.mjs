#!/usr/bin/env node
// scripts/x402-fresh-workers-run.mjs
//
// Drive the fresh-wallet workers lane locally for N ticks: the same run(ctx)
// the cron invokes, so what you observe here is exactly what production does.
// Each tick mints brand-new wallets, funds them from the ring funders, has each
// pay one real three.ws x402 endpoint, and sweeps every wallet back to zero.
//
// It is REAL end to end (no mocks): with the ring env present it moves real
// USDC and SOL inside the closed loop; without it each tick degrades to a
// clean, named skip. Use --plan to print what a tick WOULD buy and what the
// funders must hold, without touching the chain or the database.
//
// Usage:
//   node scripts/x402-fresh-workers-run.mjs --plan            # no I/O
//   node scripts/x402-fresh-workers-run.mjs [ticks]           # default 1 tick
//   X402_FRESH_WORKERS_PER_TICK=1 node scripts/x402-fresh-workers-run.mjs 1
//
// Never prints a secret; never funds anything outside the ring.

import { randomUUID } from 'node:crypto';

const args = process.argv.slice(2);
const plan = args.includes('--plan');
const ticks = Math.max(1, Number(args.find((a) => /^\d+$/.test(a)) || 1));

function line(s = '') { console.log(s); }

const {
	freshWorkersConfig, planTickJobs, fundingRequirement, walletSolLamports, RENT_EXEMPT_FALLBACK_LAMPORTS,
} = await import('../api/_lib/x402/fresh-workers/plan.js');
const { DATA_JOB_SLUGS, resolveJob } = await import('../api/_lib/x402/fresh-workers/jobs.js');

const cfg = freshWorkersConfig();
line(`\n=== three.ws x402 fresh-wallet workers (${plan ? 'plan only' : `${ticks} tick(s)`}) ===\n`);
line(`  per tick ${cfg.perTick} wallet(s), forge every ${cfg.forgeEveryNTicks} tick(s), daily cap $${(cfg.dailyCapAtomic / 1e6).toFixed(2)}, tick budget ${cfg.tickBudgetMs} ms`);

if (plan) {
	const solPerWallet = walletSolLamports({ rentExemptLamports: RENT_EXEMPT_FALLBACK_LAMPORTS, maxPayFeeLamports: cfg.maxPayFeeLamports });
	for (let t = 1; t <= 3; t++) {
		const jobs = planTickJobs({ tickSeq: t * cfg.forgeEveryNTicks, perTick: cfg.perTick, forgeEveryNTicks: cfg.forgeEveryNTicks, dataSlugs: DATA_JOB_SLUGS, cursor: (t - 1) * cfg.perTick })
			.map((p) => resolveJob(p, t));
		const need = fundingRequirement({ jobs, priceOf: (j) => j.priceAtomic, solPerWalletLamports: solPerWallet });
		line(`\n  forge tick example ${t}:`);
		for (const j of jobs) line(`    ${j.kind.padEnd(5)} ${j.slug.padEnd(20)} $${(j.priceAtomic / 1e6).toFixed(3)}  ${j.method} ${j.path}`);
		line(`    funder sends ${(need.solLamports / 1e9).toFixed(6)} SOL (${(solPerWallet / 1e9).toFixed(6)} per wallet + ATA rent, all but ~3 base fees returned) and $${(need.usdcAtomic / 1e6).toFixed(3)} USDC`);
	}
	line('');
	process.exit(0);
}

let sql = null;
try {
	({ sql } = await import('../api/_lib/db.js'));
	await sql`SELECT 1`;
} catch (e) {
	line(`  DB unreachable (${e.message}); the tick cannot record wallets, so it will not fund any.\n`);
	process.exit(1);
}

const { run } = await import('../api/_lib/x402/fresh-workers/run.js');
for (let t = 1; t <= ticks; t++) {
	const runId = randomUUID();
	const t0 = Date.now();
	const out = await run({ sql, origin: process.env.APP_ORIGIN || 'https://three.ws', runId });
	line(`\n  tick ${t}/${ticks}  ${Date.now() - t0} ms  run ${runId}`);
	if (out.skipped) {
		line(`    skipped: ${out.reason}${out.error ? ` (${out.error})` : ''}`);
		continue;
	}
	line(`    wallets ${out.wallets}  paid ${out.paid}  failed ${out.failed}  closed ${out.closed}  sweep_failed ${out.sweep_failed}  deferred ${out.deferred}  spent $${out.spent_usdc}`);
	line(`    fund tx ${out.fund_signature}`);
	for (const j of out.jobs || []) {
		line(`    ${j.kind.padEnd(5)} ${j.slug.padEnd(20)} payer ${j.payer}`);
		line(`          paid ${j.paid} $${j.amount_usdc} tx ${j.tx || '-'} stored ${j.stored} state ${j.state} sweep ${j.sweep_tx || '-'}${j.error ? ` error ${j.error}` : ''}`);
	}
	if (out.reclaim?.claimed) line(`    reclaim: ${JSON.stringify(out.reclaim)}`);
}
line('');
process.exit(0);
