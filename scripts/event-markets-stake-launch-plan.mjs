#!/usr/bin/env node
// Read-only mainnet launch plan for staked Event Markets. Prints the ordered owner
// steps with every value filled from the environment, plus a preflight computed from
// live state, and exits 1 if any preflight check fails. Sends nothing, writes nothing.
//   node --env-file=.env scripts/event-markets-stake-launch-plan.mjs [--json]
// Guide: docs/ops/event-markets-stake-launch.md.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { Keypair } from '@solana/web3.js';
import { FEE, TOKENS, stakingConfig } from '../api/_lib/event-markets/staking/config.js';
import { renderLaunchPlan } from '../api/_lib/event-markets/staking/launch-plan.js';

const pubkeyOf = (envName) => {
	const f = process.env[envName];
	if (!f || !existsSync(f)) return null;
	try {
		return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(f, 'utf8')))).publicKey.toBase58();
	} catch {
		return null;
	}
};

const cfg = stakingConfig();
const soPath = new URL('../contracts/event-markets-stake/target/deploy/event_markets_stake.so', import.meta.url);

async function safe(fn, fallback) {
	try {
		return await fn();
	} catch {
		return fallback;
	}
}

const migrationApplied = await safe(async () => {
	const { sql } = await import('../api/_lib/db.js');
	const rows = await sql`select to_regclass('event_market_stake_pools') as t`;
	return Boolean(rows[0]?.t);
}, false);

const rpcReachable = await safe(async () => {
	const { Connection } = await import('@solana/web3.js');
	await new Connection(cfg.rpcUrl, 'confirmed').getSlot();
	return true;
}, false);

const openMarkets = await safe(async () => {
	const { listMarkets } = await import('../api/_lib/event-markets/index.js');
	const out = await listMarkets({ status: 'open', limit: 50 });
	return (out.items || out.markets || []).length;
}, null);

const reconcile = await safe(async () => {
	if (!migrationApplied) return { checked: false, ok: false, detail: 'cannot reconcile: migration not applied' };
	const { reconcileAll } = await import('../api/_lib/event-markets/staking/reconcile-all.js');
	const pools = await reconcileAll();
	const bad = pools.filter((p) => !p.ok);
	return { checked: true, ok: bad.length === 0, detail: pools.length === 0 ? 'no pools yet (nothing to reconcile)' : `${pools.length} pool(s), ${bad.length} mismatched` };
}, { checked: false, ok: false, detail: 'reconciliation could not run (database or RPC unreachable)' });

const facts = {
	programId: process.env.EVENT_MARKETS_STAKE_PROGRAM_ID || null,
	programHash: existsSync(soPath) ? createHash('sha256').update(readFileSync(soPath)).digest('hex') : null,
	cluster: process.env.EVENT_MARKETS_STAKE_CLUSTER || null,
	authority: pubkeyOf('EVENT_MARKETS_STAKE_AUTHORITY_KEYPAIR'),
	resolver: pubkeyOf('EVENT_MARKETS_STAKE_RESOLVER_KEYPAIR'),
	buybackWallet: pubkeyOf('EVENT_MARKETS_STAKE_BUYBACK_KEYPAIR'),
	treasury: process.env.EVENT_MARKETS_STAKE_TREASURY || null,
	migrationApplied,
	flagEnabled: cfg.enabled,
	rpcReachable,
	openMarkets,
	reconcile,
	fee: FEE,
	caps: {
		usdc: { maxStake: TOKENS.usdc.maxStake.toString(), maxPool: TOKENS.usdc.maxPool.toString() },
		three: { maxStake: TOKENS.three.maxStake.toString(), maxPool: TOKENS.three.maxPool.toString() },
	},
};

const plan = renderLaunchPlan(facts);
if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: plan.ok, checks: plan.checks, steps: plan.steps }, null, 2));
else console.log(plan.text);
process.exit(plan.ok ? 0 : 1);
