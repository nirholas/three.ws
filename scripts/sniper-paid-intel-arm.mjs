// Provision and plan the sniper "paid-intel" arm.
//
//   node scripts/sniper-paid-intel-arm.mjs                       # plan: funding table + would-be payment requests
//   node scripts/sniper-paid-intel-arm.mjs --apply --intel-cap-usdc 2
//                                                                # create the agent, its custodial wallet, and a
//                                                                # DISABLED strategy row (no funds move)
//   node scripts/sniper-paid-intel-arm.mjs --enable              # flip the arm on (after the owner funds the wallet)
//
// The plan reads the live fleet: the arm's daily trading budget is the SMALLEST
// daily_budget_lamports among enabled arms, halved, and its position size is
// the smallest per_trade_lamports. Nothing is hardcoded. The plan also probes
// each signal endpoint for its live 402 challenge (an unpaid probe returns the
// price and payee and moves no money), so the printed prices are never stale.
//
// Funding the wallet is an on-chain spend. This script never sends funds: it
// prints the funding table and stops. Requires the
// 20261105021000_sniper_paid_intel.sql migration before --apply.

import './lib/gcloud-path.mjs';
import { createRequire } from 'node:module';
import { requireServiceEnvValue } from './lib/service-env.mjs';

const require = createRequire(import.meta.url);
const { Pool } = require('@neondatabase/serverless');

const APPLY = process.argv.includes('--apply');
const ENABLE = process.argv.includes('--enable');
const NETWORK = 'mainnet';
const OWNER_USER = 'a6a6aed1-9ecc-40cd-889b-340895ee4d8c';
const AGENT_NAME = 'Sniper Arm: Paid Intel';
const ORIGIN = process.env.SNIPER_PAID_INTEL_ORIGIN || 'https://three.ws';

function flag(name) {
	const i = process.argv.indexOf(name);
	return i >= 0 ? process.argv[i + 1] : null;
}

const SIGNALS = [
	{ name: 'launches', method: 'GET', path: '/api/x402/pump-agent-audit?limit=10&sort=newest', body: null },
	{ name: 'anomaly', method: 'POST', path: '/api/x402/crypto-intel', body: { topic: 'pump_volume_anomaly' } },
	{ name: 'trending', method: 'POST', path: '/api/x402/crypto-intel', body: { topic: 'pump_trending' } },
];

async function probe(sig) {
	const res = await fetch(`${ORIGIN}${sig.path}`, {
		method: sig.method,
		headers: { 'content-type': 'application/json', 'user-agent': 'threews-sniper-paid-intel-plan/1.0' },
		...(sig.body ? { body: JSON.stringify(sig.body) } : {}),
	});
	const text = await res.text();
	let body = null;
	try { body = JSON.parse(text); } catch { /* non-JSON challenge */ }
	const accepts = Array.isArray(body?.accepts) ? body.accepts : [];
	const sol = accepts.find((a) => String(a.network || '').startsWith('solana')) || null;
	return { status: res.status, amount: sol ? Number(sol.amount ?? sol.maxAmountRequired) : null, payTo: sol?.payTo || null, asset: sol?.asset || null };
}

const dbUrl = process.env.DATABASE_URL || requireServiceEnvValue('DATABASE_URL');
const pool = new Pool({ connectionString: dbUrl });

const { rows: fleet } = await pool.query(
	`select min(daily_budget_lamports)::text as min_budget, min(per_trade_lamports)::text as min_trade, count(*)::int as arms
	   from agent_sniper_strategies
	  where network = $1 and enabled = true and kill_switch = false and daily_budget_lamports > 0 and per_trade_lamports > 0
	    and decision_mode <> 'paid_intel'`,
	[NETWORK],
);
const minBudget = BigInt(fleet[0]?.min_budget ?? '0');
const minTrade = BigInt(fleet[0]?.min_trade ?? '0');
if (minBudget === 0n || minTrade === 0n) {
	console.error('No enabled arms found in the live fleet; cannot derive the arm budget.');
	process.exit(1);
}
const dailyBudget = minBudget / 2n;
const perTrade = minTrade < dailyBudget ? minTrade : dailyBudget;

const probes = [];
for (const sig of SIGNALS) probes.push({ ...sig, ...(await probe(sig).catch((err) => ({ status: 0, error: err.message }))) });
const cycleAtomic = probes.reduce((a, p) => a + (p.amount || 0), 0);
const capUsdc = Number(flag('--intel-cap-usdc') ?? 2);
const capAtomic = BigInt(Math.round(capUsdc * 1e6));

console.log(`Fleet: ${fleet[0].arms} enabled arms. Smallest daily budget ${Number(minBudget) / 1e9} SOL, smallest position ${Number(minTrade) / 1e9} SOL.`);
console.log('\nWould-be payment requests per cycle (live 402 challenges, nothing paid):');
for (const p of probes) {
	console.log(`  ${p.name.padEnd(9)} ${p.method} ${ORIGIN}${p.path}  -> ${p.status}  ${p.amount != null ? `${p.amount / 1e6} USDC` : 'no solana accept'}  payTo ${p.payTo || '-'}`);
}
console.log(`  one cycle = ${cycleAtomic / 1e6} USDC; a ${capUsdc} USDC daily cap funds ${cycleAtomic ? Math.floor(Number(capAtomic) / cycleAtomic) : 0} cycles/day`);

const { rows: [existing] } = await pool.query(
	`select a.id, a.meta->>'solana_address' as addr from agent_identities a where a.user_id = $1 and a.name = $2 and a.deleted_at is null`,
	[OWNER_USER, AGENT_NAME],
);
let walletAddress = existing?.addr || null;

if (APPLY) {
	let agentId = existing?.id;
	if (!agentId) {
		const { rows: [created] } = await pool.query(
			`insert into agent_identities (user_id, name, description, is_public) values ($1, $2, $3, false) returning id`,
			[OWNER_USER, AGENT_NAME, 'Autonomous sniper experiment arm: buys paid x402 launch, volume-anomaly and trending signals before every entry.'],
		);
		agentId = created.id;
	}
	// The wallet module reads process.env, not this script's pool. Give it the
	// production database and the production at-rest key, and run it under
	// NODE_ENV=production so secret-box fails closed instead of encrypting the
	// new key under the JWT_SECRET fallback, which production could not decrypt.
	process.env.DATABASE_URL = dbUrl;
	process.env.WALLET_ENCRYPTION_KEY = process.env.WALLET_ENCRYPTION_KEY || requireServiceEnvValue('WALLET_ENCRYPTION_KEY');
	process.env.NODE_ENV = 'production';
	const { ensureAgentWallet } = await import('../api/_lib/agent-wallet.js');
	const wallet = await ensureAgentWallet(agentId, OWNER_USER, { reason: 'sniper_paid_intel_arm' });
	walletAddress = wallet.address;
	const s = {
		agent_id: agentId, user_id: OWNER_USER, network: NETWORK, label: 'paid-intel', experiment_group: 'x402',
		enabled: false, kill_switch: false, trigger: 'new_mint', decision_mode: 'paid_intel',
		require_socials: false, require_sol_quote: true,
		per_trade_lamports: perTrade.toString(), daily_budget_lamports: dailyBudget.toString(),
		max_concurrent_positions: 1, slippage_bps: 500, max_price_impact_pct: 10,
		stop_loss_pct: 30, trailing_stop_pct: 20, take_profit_pct: 60, max_hold_seconds: 1800,
		initials_out_multiple: 2, auto_fund_enabled: false, intel_daily_cap_atomic: capAtomic.toString(),
	};
	const cols = Object.keys(s);
	const updates = cols.filter((c) => !['agent_id', 'network'].includes(c)).map((c) => `${c} = excluded.${c}`).join(', ');
	const { rows: [row] } = await pool.query(
		`insert into agent_sniper_strategies (${cols.join(', ')}, updated_at) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}, now())
		 on conflict (agent_id, network) do update set ${updates}, updated_at = now() returning id, enabled`,
		cols.map((c) => s[c]),
	);
	console.log(`\nProvisioned agent ${agentId}, strategy ${row.id} (enabled=${row.enabled}).`);
}

if (ENABLE) {
	const { rowCount } = await pool.query(
		`update agent_sniper_strategies set enabled = true, updated_at = now()
		  where network = $1 and decision_mode = 'paid_intel' and intel_daily_cap_atomic > 0`,
		[NETWORK],
	);
	console.log(`\nEnabled ${rowCount} paid-intel arm(s).`);
}

console.log('\nFunding request (owner yes required before any transfer):');
console.log('  | field            | value |');
console.log('  |------------------|-------|');
console.log(`  | arm wallet       | ${walletAddress || '(created by --apply)'} |`);
console.log(`  | SOL (trading)    | ${Number(dailyBudget) / 1e9} SOL daily budget, ${Number(perTrade) / 1e9} SOL per position, plus fee headroom |`);
console.log(`  | USDC (signals)   | ${capUsdc} USDC per day cap (${cycleAtomic / 1e6} USDC per cycle) |`);
console.log('  | chain            | Solana mainnet |');
console.log('  | window           | first 76 hours |');
if (!APPLY && !ENABLE) console.log('\nPlan only. Re-run with --apply to provision (no funds move).');
await pool.end();
