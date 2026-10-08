#!/usr/bin/env node
/**
 * Sniper fleet capital check + restore.
 *
 * Answers one question the dashboards could not: **can each armed strategy
 * actually place its next trade right now?** A wallet is not "funded" because it
 * holds SOL — it is funded when it holds enough for the entry PLUS everything the
 * entry needs around it (the token ATA's rent, fee and tip headroom, and the
 * buy→sell round-trip the rug/honeypot firewall simulates from that same wallet
 * before any broadcast). An arm under that line looks healthy everywhere and
 * aborts every buy at a safety check it cannot afford to run.
 *
 * Dry by default: it reads chain + database and prints the deficit table. Nothing
 * moves without `--apply`, and `--apply` still refuses to run without `--yes`.
 * Transfers go through the same guarded path the auto-funder uses
 * (`fundAgentForLaunch`), so the per-transfer cap, the daily cap, and the master's
 * own balance buffer all still apply — this script cannot spend past them.
 *
 * Usage:
 *   node scripts/sniper-fleet-restore.mjs                  # report only
 *   node scripts/sniper-fleet-restore.mjs --json           # machine-readable
 *   node scripts/sniper-fleet-restore.mjs --apply --yes    # top up the deficits
 *   node scripts/sniper-fleet-restore.mjs --target 0.08    # override the per-arm target
 *   node scripts/sniper-fleet-restore.mjs --from-platform-bots              # plan from idle bots
 *   node scripts/sniper-fleet-restore.mjs --from-platform-bots --apply --yes
 *
 * `--from-platform-bots` funds the arms from idle platform-owned agent wallets
 * instead of the funding master, for when the master itself is dry. Sources are
 * restricted to agents owned by the house account or a `*@agents.three.ws`
 * circulation bot (`isPlatformOwnedAgent`, checked in SQL and again in JS) that
 * have no sniper strategy at all and no open position, and each keeps the idle
 * fee floor the economy reclaim leaves it (`agentReclaimFloorSol`). A customer's
 * wallet is never a source. Only arms that opted into auto-funding AND whose one
 * blocking stall is `wallet_dry` are targets: funding an arm parked on an offline
 * model or an unreachable mcap band spends SOL that cannot trade, and funding an
 * arm the auto-funder does not manage would be swept straight back by the
 * reclaim leg, which only honors the funding target for opted-in wallets.
 */

import { config as dotenv } from 'dotenv';
import { PublicKey } from '@solana/web3.js';

dotenv({ path: '.env' });
dotenv({ path: '.env.local', override: false });

const { sql } = await import('../api/_lib/db.js');
const { solanaConnection } = await import('../api/_lib/solana/connection.js');
const { MIN_OPERATIONAL_WALLET_SOL } = await import('../api/_lib/agent-trade-guards.js');
const { autoFundTargetSol, fundTargetSol } = await import('../api/_lib/agent-funding-policy.js');
const { fundAgentForLaunch, masterBalanceSol } = await import('../api/_lib/launcher-funding.js');
const { diagnoseStall } = await import('../api/_lib/sniper-stall.js');
const {
	isPlatformOwnedAgent,
	agentReclaimFloorSol,
	PLATFORM_AGENT_OWNER_EMAIL,
	PLATFORM_AGENT_EMAIL_SUFFIX,
} = await import('../api/_lib/economy-sweepback.js');
const { sendSol } = await import('../api/_lib/avatar-wallet.js');
const { recoverSolanaAgentKeypair } = await import('../api/_lib/agent-wallet.js');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const opt = (f, d) => {
	const i = args.indexOf(f);
	return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const NETWORK = opt('--network', 'mainnet');
const APPLY = has('--apply');
const CONFIRMED = has('--yes');
const JSON_OUT = has('--json');
const TARGET_SOL = Number(opt('--target', autoFundTargetSol()));
const FROM_BOTS = has('--from-platform-bots');

// Left in each source on top of its idle floor to pay the transfer's own fee
// (base fee plus the priority fee submitProtected attaches; no Jito tip).
const SOURCE_FEE_RESERVE_SOL = 0.0001;
// Smallest pull worth a transaction: below this the fee is a real fraction of it.
const MIN_SOURCE_PULL_SOL = 0.002;

const sol = (n) => `${Number(n).toFixed(4)} SOL`;

/**
 * What one arm needs to hold to place its next trade. Delegated to the shared
 * funding policy the auto-funder and the economy reclaim both read, so this tool
 * cannot disagree with the crons about the same wallet. `--target` raises the
 * floor for a manual top-up; it never lowers it below the policy.
 * @param {{perTradeSol:number}} arm
 */
function requiredSol(arm) {
	return Math.max(TARGET_SOL, fundTargetSol({ perTradeSol: Number(arm.perTradeSol) || 0 }));
}

const rows = await sql`
	SELECT s.id, s.label, s.enabled, s.auto_fund_enabled, s.kill_switch,
	       s.per_trade_lamports, s.daily_budget_lamports, s.trigger, s.decision_mode,
	       s.llm_model, s.llm_strict_model, s.min_market_cap_usd,
	       a.id AS agent_id, a.name AS agent_name,
	       a.meta->>'solana_address' AS address,
	       LOWER(u.email) AS owner,
	       (SELECT COUNT(*) FROM agent_sniper_positions p
	         WHERE p.strategy_id = s.id AND p.status = 'open')::int AS open_positions,
	       (SELECT COUNT(*) FROM agent_sniper_positions p
	         WHERE p.strategy_id = s.id AND p.status = 'closed' AND p.buy_sig <> 'SIMULATED')::int AS closed
	FROM agent_sniper_strategies s
	JOIN agent_identities a ON a.id = s.agent_id AND a.deleted_at IS NULL
	JOIN users u ON u.id = a.user_id
	WHERE s.network = ${NETWORK} AND s.enabled = true
	ORDER BY s.label NULLS LAST
`;

// Whether each named LLM model is actually answering, or whether the failover
// chain has been answering for it. A strict arm refuses a fallback verdict, so
// without this the tool would blame "nothing qualified" for a parked model.
const modelAnswers = new Map(
	(await sql`
		SELECT model,
		       count(*)::int                                    AS verdicts,
		       count(*) FILTER (WHERE answered_by = model)::int  AS named_answers
		FROM sniper_llm_verdicts
		WHERE network = ${NETWORK} AND created_at > now() - interval '24 hours'
		GROUP BY model
	`.catch(() => [])).map((m) => [m.model, m]),
);

const connection = solanaConnection({ network: NETWORK });

const arms = [];
for (const r of rows) {
	if (!r.address) continue;
	let balance = null;
	try {
		balance = (await connection.getBalance(new PublicKey(r.address), 'confirmed')) / 1e9;
	} catch (err) {
		console.error(`  ! balance read failed for ${r.label || r.agent_name}: ${err.message}`);
	}
	const perTradeSol = r.per_trade_lamports != null ? Number(r.per_trade_lamports) / 1e9 : 0;
	const need = requiredSol({ perTradeSol });
	arms.push({
		strategyId: r.id,
		label: r.label || `strategy:${String(r.id).slice(0, 8)}`,
		agentId: r.agent_id,
		agentName: r.agent_name,
		owner: r.owner,
		address: r.address,
		autoFundEnabled: r.auto_fund_enabled === true,
		perTradeSol,
		openPositions: r.open_positions,
		closed: r.closed,
		balanceSol: balance,
		requiredSol: need,
		deficitSol: balance == null ? null : Math.max(0, Number((need - balance).toFixed(6))),
		stall: diagnoseStall({
			strategy: r,
			closed: r.closed,
			open: r.open_positions,
			balanceSol: balance,
			verdictCount: Number(modelAnswers.get(r.llm_model)?.verdicts) || 0,
			namedModelAnswers: Number(modelAnswers.get(r.llm_model)?.named_answers) || 0,
		}),
	});
}

const masterSol = await masterBalanceSol(NETWORK).catch(() => null);
const fundable = arms.filter((a) => a.deficitSol > 0 && a.autoFundEnabled);
const unfundable = arms.filter((a) => a.deficitSol > 0 && !a.autoFundEnabled);
const totalDeficit = Number(fundable.reduce((s, a) => s + a.deficitSol, 0).toFixed(6));

if (JSON_OUT) {
	console.log(JSON.stringify({ network: NETWORK, targetSol: TARGET_SOL, masterSol, totalDeficit, arms }, null, 2));
	process.exit(0);
}

console.log(`\nSniper fleet capital — ${NETWORK}`);
console.log(`Per-arm target ${sol(TARGET_SOL)} · operational minimum ${sol(MIN_OPERATIONAL_WALLET_SOL)} + size\n`);
console.log(
	'  '
	+ 'arm'.padEnd(20) + 'balance'.padStart(12) + 'needs'.padStart(12) + 'deficit'.padStart(12)
	+ '  ' + 'fund?'.padEnd(7) + 'status',
);
for (const a of arms) {
	const flag = a.deficitSol > 0 ? (a.autoFundEnabled ? 'auto' : 'MANUAL') : '-';
	const extra = a.stall?.also?.length ? ` (+${a.stall.also.map((x) => x.code).join(', ')})` : '';
	const status = a.stall ? `${a.stall.blocking ? '[BLOCKING] ' : ''}${a.stall.code}${extra}` : 'trading';
	console.log(
		'  '
		+ a.label.padEnd(20)
		+ (a.balanceSol == null ? '?' : a.balanceSol.toFixed(4)).padStart(12)
		+ a.requiredSol.toFixed(4).padStart(12)
		+ (a.deficitSol == null ? '?' : a.deficitSol.toFixed(4)).padStart(12)
		+ '  ' + flag.padEnd(7) + status,
	);
}

console.log(`\nFunding master holds ${masterSol == null ? '?' : sol(masterSol)}.`);
console.log(`${fundable.length} arm(s) short by ${sol(totalDeficit)} in total.`);
if (unfundable.length) {
	console.log(`${unfundable.length} arm(s) are short but have NOT opted into auto-funding (auto_fund_enabled = false):`);
	for (const a of unfundable) console.log(`  · ${a.label} (${a.agentName}) short ${sol(a.deficitSol)}`);
}
if (FROM_BOTS) {
	await restoreFromPlatformBots();
	process.exit(0);
}

if (masterSol != null && totalDeficit > masterSol) {
	console.log(`\n  The master cannot cover this: it needs ${sol(totalDeficit - masterSol)} more before the fleet is whole.`);
}

if (!APPLY) {
	console.log('\nDry run — nothing moved. Re-run with `--apply --yes` to top up the fundable arms.\n');
	process.exit(0);
}

if (!CONFIRMED) {
	console.log('\nRefusing to move SOL without `--yes`. Review the table above first.\n');
	process.exit(1);
}

console.log(`\nMoving ${sol(totalDeficit)} from the funding master to ${fundable.length} arm(s)...\n`);
let moved = 0;
for (const a of fundable) {
	try {
		const res = await fundAgentForLaunch({
			agentId: a.agentId,
			address: a.address,
			amountSol: a.deficitSol,
			network: NETWORK,
			reason: 'sniper_fleet_restore',
		});
		moved += a.deficitSol;
		console.log(`  ✓ ${a.label.padEnd(20)} +${sol(a.deficitSol)}  ${res?.signature || ''}`);
	} catch (err) {
		console.log(`  ✗ ${a.label.padEnd(20)} ${err.message}`);
	}
}
console.log(`\nMoved ${sol(moved)}.\n`);
process.exit(0);

/**
 * Whether topping this arm up actually lets it trade: its stall is `wallet_dry`
 * and nothing else it reports is blocking.
 * @param {{code:string, blocking?:boolean, also?:Array<{blocking?:boolean}>}|null} stall
 */
function fundingUnblocks(stall) {
	return stall?.code === 'wallet_dry' && !(stall.also || []).some((x) => x.blocking);
}

/**
 * Pair idle platform-bot SOL with arm deficits, biggest source first. A source can
 * split across arms; every leg still leaves the source at or above its floor.
 * @param {Array<{agentId:string,name:string,address:string,excessSol:number}>} sources
 * @param {Array<{label:string,agentId:string,address:string,deficitSol:number}>} targets
 */
function planBotTransfers(sources, targets) {
	const legs = [];
	const pool = sources.map((s) => ({ ...s, left: s.excessSol })).sort((a, b) => b.left - a.left);
	for (const t of targets) {
		let need = t.deficitSol;
		for (const s of pool) {
			if (need <= 0) break;
			if (s.left < MIN_SOURCE_PULL_SOL) continue;
			const amount = Number(Math.min(s.left, need).toFixed(9));
			if (amount < MIN_SOURCE_PULL_SOL && amount < need) continue;
			legs.push({ from: s, to: t, amountSol: amount });
			s.left = Number((s.left - amount).toFixed(9));
			need = Number((need - amount).toFixed(9));
		}
	}
	return legs;
}

async function restoreFromPlatformBots() {
	const targets = arms.filter(
		(a) => a.deficitSol > 0 && a.autoFundEnabled && isPlatformOwnedAgent(a.owner) && fundingUnblocks(a.stall),
	);
	const passed = arms.filter((a) => a.deficitSol > 0 && !targets.includes(a));

	const sourceRows = await sql`
		SELECT a.id AS agent_id, a.name,
		       a.meta->>'solana_address' AS address,
		       a.meta->>'encrypted_solana_secret' AS secret,
		       LOWER(u.email) AS owner
		FROM agent_identities a
		JOIN users u ON u.id = a.user_id
		WHERE a.deleted_at IS NULL
		  AND a.meta->>'solana_address' IS NOT NULL
		  AND a.meta->>'encrypted_solana_secret' IS NOT NULL
		  AND (LOWER(u.email) = ${PLATFORM_AGENT_OWNER_EMAIL}
		       OR LOWER(u.email) LIKE ${'%' + PLATFORM_AGENT_EMAIL_SUFFIX})
		  AND NOT EXISTS (SELECT 1 FROM agent_sniper_strategies s WHERE s.agent_id = a.id)
		  AND NOT EXISTS (SELECT 1 FROM agent_sniper_positions p
		                   WHERE p.agent_id = a.id AND p.status IN ('open', 'closing'))
	`;

	const floorSol = agentReclaimFloorSol({ enabled: false, autoFundEnabled: false });
	const sources = [];
	const unreadable = [];
	for (const r of sourceRows) {
		if (!isPlatformOwnedAgent(r.owner)) continue;
		let bal;
		try {
			bal = (await connection.getBalance(new PublicKey(r.address), 'confirmed')) / 1e9;
		} catch (err) {
			unreadable.push({ name: r.name, reason: `balance: ${err.message}` });
			continue;
		}
		const excessSol = Number((bal - floorSol - SOURCE_FEE_RESERVE_SOL).toFixed(9));
		if (excessSol < MIN_SOURCE_PULL_SOL) continue;
		// The same gate the real leg runs: a key that will not decrypt is not capital.
		let keypair;
		try {
			keypair = await recoverSolanaAgentKeypair(r.secret, null);
		} catch (err) {
			unreadable.push({ name: r.name, address: r.address, sol: bal, reason: `secret_undecryptable: ${err.message}` });
			continue;
		}
		if (keypair.publicKey.toBase58() !== r.address) {
			unreadable.push({ name: r.name, address: r.address, sol: bal, reason: 'keypair_address_mismatch' });
			continue;
		}
		sources.push({ agentId: r.agent_id, name: r.name, address: r.address, owner: r.owner, secret: r.secret, balanceSol: bal, excessSol });
	}

	const legs = planBotTransfers(sources, targets);
	const available = Number(sources.reduce((s, x) => s + x.excessSol, 0).toFixed(6));
	const planned = Number(legs.reduce((s, l) => s + l.amountSol, 0).toFixed(6));
	const wanted = Number(targets.reduce((s, t) => s + t.deficitSol, 0).toFixed(6));

	console.log(`\nSource: idle platform-owned bot wallets (floor ${sol(floorSol)} each + ${sol(SOURCE_FEE_RESERVE_SOL)} fee reserve)`);
	console.log(`  ${sources.length} wallet(s) with spare SOL, ${sol(available)} available above floor.`);
	for (const u of unreadable) console.log(`  ! skipped ${u.name}${u.sol != null ? ` (${sol(u.sol)})` : ''}: ${u.reason}`);

	console.log('\nTargets (auto-funded, platform-owned, only blocker is wallet_dry):');
	for (const t of targets) {
		const got = legs.filter((l) => l.to === t).reduce((s, l) => s + l.amountSol, 0);
		console.log(`  ${t.label.padEnd(20)} ${t.address}  +${sol(got)} of ${sol(t.deficitSol)}`);
	}
	for (const a of passed) {
		const why = !a.autoFundEnabled ? 'not opted into auto-funding (reclaim would sweep it back)'
			: !isPlatformOwnedAgent(a.owner) ? 'not platform-owned'
			: `funding does not unblock it (${[a.stall?.code, ...(a.stall?.also || []).filter((x) => x.blocking).map((x) => x.code)].filter(Boolean).join(', ')})`;
		console.log(`  - ${a.label.padEnd(18)} passed over: ${why}`);
	}
	console.log(`\n${legs.length} transfer(s), ${sol(planned)} of the ${sol(wanted)} the targets need.`);

	if (!APPLY) {
		console.log('\nDry run: nothing moved. Re-run with `--from-platform-bots --apply --yes` to send these transfers.\n');
		for (const l of legs) console.log(`  ${l.from.name.padEnd(16)} ${l.from.address} → ${l.to.label.padEnd(18)} ${sol(l.amountSol)}`);
		console.log('');
		return;
	}
	if (!CONFIRMED) {
		console.log('\nRefusing to move SOL without `--yes`. Review the plan above first.\n');
		return;
	}

	let moved = 0;
	for (const l of legs) {
		try {
			const keypair = await recoverSolanaAgentKeypair(l.from.secret, {
				agentId: l.from.agentId,
				reason: 'sniper_fleet_restore_from_bots',
				meta: { to: l.to.address, sol: l.amountSol },
			});
			const signature = await sendSol({
				connection,
				fromKeypair: keypair,
				to: l.to.address,
				lamports: Math.round(l.amountSol * 1e9),
				memo: `three.ws fleet restore ${l.from.name} → ${l.to.label}`,
				network: NETWORK,
			});
			moved += l.amountSol;
			console.log(`  ✓ ${l.from.name.padEnd(16)} → ${l.to.label.padEnd(18)} ${sol(l.amountSol)}  ${signature}`);
		} catch (err) {
			console.log(`  ✗ ${l.from.name.padEnd(16)} → ${l.to.label.padEnd(18)} ${sol(l.amountSol)}  ${err.message}`);
		}
	}
	console.log(`\nMoved ${sol(moved)} of ${sol(planned)}.\n`);
}
