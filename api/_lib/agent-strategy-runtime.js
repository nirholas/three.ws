// Strategy Object runtime — turns an equipped, rule-based Strategy into the
// agent's REAL, server-signed, fully-leashed trading.
//
// Safe by construction: every strategy-initiated trade runs through the SAME
// shared spend guardrails (api/_lib/agent-trade-guards.js) the discretionary
// trade endpoint, the sniper, and the mirror executor use; the SAME pump quote +
// instruction builders (api/agents/solana-trade.js); the SAME MEV-aware execution
// engine; and lands in the SAME custody ledger (agent_custody_events, category
// 'trade', reason 'strategy:<slug>', meta.strategy = { strategy_id, equip_id… }).
// A strategy can NEVER bypass a limit:
//   • the per-owner global kill switch (strategy_kill_switch) and the per-equip
//     `active` flag both halt it before any tx;
//   • the agent's per-trade cap, rolling daily budget, USD ceiling, price-impact
//     breaker, rug/honeypot firewall, and SOL headroom all gate every buy;
//   • the strategy's OWN caps (per-trade size, slippage, max concurrent, cooldown)
//     are ADDITIONAL constraints layered on top — never a way around the leash;
//   • a retried (equip, mint) never double-spends — the custody idempotency key and
//     the agent_strategy_positions unique (agent,mint,network) index both dedupe it.
//
// Trigger source: REAL pump.fun launches (api/_lib/pump-launch-feed.js) for entries;
// REAL on-chain re-quotes (quoteTrade sell) for exits. No synthetic launches, no
// simulated fills, no fabricated prices — entries are best-effort, exits are real.

import { PublicKey } from '@solana/web3.js';
import { sql } from './db.js';
import { quoteTrade, buildTradeInstructions } from '../agents/solana-trade.js';
import { recoverSolanaAgentKeypair } from './agent-wallet.js';
import { solanaConnection } from './agent-pumpfun.js';
import { submitProtected } from './execution-engine.js';
import { assessTradeSafety, recordFirewallDecision } from './trade-firewall.js';
import { logAudit } from './audit.js';
import { cacheSet } from './cache.js';
import { WSOL_MINT } from './pump-trade-args.js';
import { pushGuardEvent } from './feed.js';
import {
	getSpendLimits, getTradeLimits, enforceSpendLimit, SpendLimitError, lamportsToUsd,
	getDailySpendLamports, updateCustodyEvent,
	checkPerTradeCap, checkDailyBudgetLamports, checkSolHeadroom, checkPriceImpact,
	SOL_FEE_HEADROOM_LAMPORTS,
} from './agent-trade-guards.js';
import {
	normalizeStrategyConfig, matchesEntry, shouldExit,
	researchGatesActive, evaluateResearchGates,
} from './strategy-schema.js';
import { recentPumpLaunches, enrichCreatorStats } from './pump-launch-feed.js';
import { buildGateReport } from './strategy-research.js';
import {
	recordCandidateDecision, createStrategyApproval, pendingApprovalCount, recentDecisions,
	payloadHash, STRATEGY_APPROVAL_SOURCE,
} from './strategy-approvals.js';

const LAMPORTS_PER_SOL = 1_000_000_000;
const lamToSol = (l) => Number(BigInt(l)) / LAMPORTS_PER_SOL;
const netOf = (v) => (v === 'devnet' ? 'devnet' : 'mainnet');

// Human-readable labels for the skip/exit codes the runtime emits, surfaced in the
// owner's activity feed so a "skipped" line always explains itself.
export const STRATEGY_SKIP_LABELS = Object.freeze({
	kill_switch: 'agent trade kill switch is on',
	owner_kill: 'your strategy kill switch is engaged',
	per_trade_cap: 'over the agent’s per-trade SOL cap',
	daily_budget: 'agent’s daily SOL budget reached',
	daily_cap: 'agent’s daily USD ceiling reached',
	per_tx_cap: 'over the agent’s per-trade USD cap',
	frozen: 'agent wallet is frozen',
	price_impact: 'price impact above the limit',
	firewall_blocked: 'blocked by the rug/honeypot firewall',
	insufficient_sol: 'not enough SOL for size + fees',
	no_market: 'no tradeable market for this mint',
	mayhem: 'pump.fun mayhem-mode coin — agents only buy regular coins',
	wsol: 'wrapped SOL is not a tradeable target',
	max_concurrent: 'at the strategy’s max concurrent positions',
	cooldown: 'within the strategy’s cooldown window',
	already_held: 'agent already holds a position in this mint',
	wallet_preparing: 'agent wallet still provisioning',
	no_holding: 'no token balance to exit',
	research_blocked: 'blocked by the strategy’s research gates',
	approval_unavailable: 'ask mode could not file an approval request',
});

// ── agent loader ──────────────────────────────────────────────────────────────
async function loadAgent(agentId) {
	const [row] = await sql`
		SELECT id, user_id, name, meta FROM agent_identities WHERE id = ${agentId} AND deleted_at IS NULL
	`;
	if (!row) return null;
	const meta = { ...(row.meta || {}) };
	return {
		id: row.id,
		ownerId: row.user_id,
		name: row.name,
		meta,
		address: meta.solana_address || null,
		encryptedSecret: meta.encrypted_solana_secret || null,
	};
}

// The agent's full token balance for a mint (raw base units) — used to value an
// open position (re-quote a sell of the real holding) and to size the real exit.
async function readTokenBalance(conn, ownerPk, mintPk) {
	try {
		const res = await conn.getParsedTokenAccountsByOwner(ownerPk, { mint: mintPk });
		let raw = 0n;
		let decimals = 6;
		for (const acc of res?.value || []) {
			const info = acc.account?.data?.parsed?.info?.tokenAmount;
			if (info?.amount) raw += BigInt(info.amount);
			if (Number.isInteger(info?.decimals)) decimals = info.decimals;
		}
		return { raw, decimals };
	} catch {
		return { raw: 0n, decimals: 6 };
	}
}

// ── the guarded strategy trade ────────────────────────────────────────────────
// The SAME guard sequence as handleTrade (api/agents/solana-trade.js) and the
// mirror executor, composed for a server-initiated strategy action. Returns a
// structured result — never throws past the boundary. Labels the custody trail
// with reason 'strategy:<slug>' so every fill is attributable to the strategy.
//
// `maxPriceImpactPct` tightens the agent's breaker for this trade (a strategy's
// own max_price_impact_bps); it can never loosen it. `preAssessment` reuses a
// firewall verdict the research gates already computed for this exact buy, so
// the firewall is not run twice. `dryRun` stops after every guard and returns
// { status: 'ready', quote } without claiming custody or signing: ask mode uses
// it so an owner is only ever asked about a trade the guards would allow.
export async function runStrategyTrade({
	agent, side, mint, network, solAmount, tokenAmountRaw, slippageBps, idempotencyKey, strategyRef,
	maxPriceImpactPct = null, preAssessment = null, dryRun = false,
}) {
	const { id, ownerId, meta, address, encryptedSecret } = agent;
	if (!address || !encryptedSecret) return { status: 'failed', code: 'wallet_preparing' };

	let mintPk; let ownerPk;
	try { mintPk = new PublicKey(mint); ownerPk = new PublicKey(address); }
	catch { return { status: 'failed', code: 'bad_address' }; }
	if (mint === WSOL_MINT) return { status: 'skipped', code: 'wsol' };

	const conn = solanaConnection(network);

	// 1. Quote — real pump curve / AMM pricing.
	let quote;
	try {
		quote = await quoteTrade({ conn, side, mintPk, mintStr: mint, network, solAmount, tokenAmountRaw, slippageBps });
	} catch (e) {
		if (e?.code === 'pool_not_found') return { status: 'skipped', code: 'no_market' };
		// Mayhem-mode coins are refused by policy, not a pricing failure — record
		// it as a clean skip so the feed reads "skipped: mayhem", not an error.
		if (e?.code === 'mayhem_blocked') return { status: 'skipped', code: 'mayhem' };
		return { status: 'failed', code: e?.code || 'quote_failed', message: (e?.message || '').slice(0, 200) };
	}

	let usdValue = null;
	try {
		const lamports = side === 'buy' ? BigInt(quote.inAtomics) : BigInt(quote.outAtomics);
		usdValue = await lamportsToUsd(lamports);
	} catch { usdValue = null; }

	const limitsCfg = getSpendLimits(meta);
	const tradeLimits = getTradeLimits(meta);

	// 2. Guards — identical predicates to the discretionary path.
	if (tradeLimits.kill_switch) return { status: 'skipped', code: 'kill_switch' };

	if (side === 'buy') {
		const lamportsIn = BigInt(quote.inAtomics);
		const capLamports = tradeLimits.per_trade_sol == null ? null : BigInt(Math.floor(tradeLimits.per_trade_sol * LAMPORTS_PER_SOL));
		if (checkPerTradeCap(lamportsIn, capLamports)) return { status: 'skipped', code: 'per_trade_cap' };

		if (tradeLimits.daily_budget_sol != null) {
			const budgetLamports = BigInt(Math.floor(tradeLimits.daily_budget_sol * LAMPORTS_PER_SOL));
			const spent = await getDailySpendLamports(id, network);
			if (checkDailyBudgetLamports(spent, lamportsIn, budgetLamports)) return { status: 'skipped', code: 'daily_budget' };
		}
		try {
			// `meta` carries the natural-language policy (meta.policy_rules) so the
			// owner's English rules govern this autonomous strategy trade too.
			await enforceSpendLimit({ agentId: id, meta, limits: limitsCfg, category: 'trade', usdValue, asset: 'SOL', network });
		} catch (e) {
			if (e instanceof SpendLimitError) return { status: 'skipped', code: e.code };
			throw e;
		}
	}

	const agentImpactCap = tradeLimits.max_price_impact_pct;
	const impactCap = side === 'buy' && maxPriceImpactPct != null
		? (agentImpactCap == null ? maxPriceImpactPct : Math.min(maxPriceImpactPct, agentImpactCap))
		: agentImpactCap;
	if (checkPriceImpact(quote.priceImpactPct, impactCap)) {
		return { status: 'skipped', code: 'price_impact', priceImpact: quote.priceImpactPct, impactCap };
	}

	// 3. Rug/honeypot firewall — buys only, the unsafe direction. A 'block' verdict
	//    refuses the entry (degrades to allow when a source is down, never stalls).
	if (side === 'buy') {
		const assessment = preAssessment || await assessTradeSafety({
			network, mint: mintPk, side: 'buy', payer: ownerPk,
			quoteAmount: BigInt(quote.inAtomics), priceImpactPct: quote.priceImpactPct,
		}).catch(() => null);
		if (assessment) {
			recordFirewallDecision({
				mint, network, side: 'buy', verdict: assessment.verdict, score: assessment.score,
				simulated: assessment.simulated, checks: assessment.checks, reasons: assessment.reasons,
				source: 'strategy', agentId: id, userId: ownerId,
				quoteLamports: BigInt(quote.inAtomics), enforced: assessment.verdict === 'block',
			}).catch(() => {});
			if (assessment.verdict === 'block') return { status: 'skipped', code: 'firewall_blocked' };
		}
	}

	// 4. SOL fee/headroom against the real on-chain balance.
	let walletLamports = null;
	try { walletLamports = BigInt(await conn.getBalance(ownerPk, 'confirmed')); }
	catch { walletLamports = null; }
	if (walletLamports != null) {
		const spendLamports = side === 'buy' ? BigInt(quote.inAtomics) : 0n;
		if (checkSolHeadroom(walletLamports, spendLamports, SOL_FEE_HEADROOM_LAMPORTS)) {
			return { status: 'skipped', code: 'insufficient_sol' };
		}
	}

	if (dryRun) return { status: 'ready', quote, usd: usdValue, priceImpact: quote.priceImpactPct, impactCap };

	// 5. Idempotency claim in the custody ledger (also the spend row). A retry with
	//    the same key replays instead of double-spending.
	const [prior] = await sql`
		SELECT status, signature, id FROM agent_custody_events
		WHERE agent_id = ${id} AND idempotency_key = ${idempotencyKey} LIMIT 1
	`;
	if (prior) {
		if (prior.status === 'confirmed' && prior.signature) {
			return { status: 'executed', signature: prior.signature, custodyEventId: Number(prior.id), usd: usdValue, priceImpact: quote.priceImpactPct, quote, replayed: true };
		}
		if (prior.status === 'pending') return { status: 'failed', code: 'in_flight' };
		return { status: 'failed', code: 'prior_failed' };
	}

	const reason = `strategy:${strategyRef?.slug || 'strategy'}`.slice(0, 64);
	const eventMeta = {
		side, mint, venue: quote.venue, reason,
		expected_out_atomics: quote.outAtomics, min_out_atomics: quote.minOutAtomics,
		slippage_bps: slippageBps, price_impact_pct: quote.priceImpactPct,
		strategy: strategyRef,
	};
	const claim = await sql`
		INSERT INTO agent_custody_events
			(agent_id, user_id, event_type, category, network, asset,
			 amount_lamports, amount_raw, usd, status, reason, idempotency_key, meta)
		VALUES (
			${id}, ${ownerId}, 'spend', 'trade', ${network},
			${side === 'buy' ? 'SOL' : mint},
			${side === 'buy' ? quote.inAtomics : null},
			${side === 'sell' ? quote.inAtomics : null},
			${side === 'buy' ? usdValue ?? null : null},
			'pending', ${reason}, ${idempotencyKey},
			${JSON.stringify(eventMeta)}::jsonb
		)
		ON CONFLICT (agent_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
		RETURNING id
	`;
	if (!claim.length) return { status: 'failed', code: 'in_flight' };
	const claimId = Number(claim[0].id);

	// 6. Recover the key (audit-logged), build, broadcast, confirm.
	let keypair;
	try {
		keypair = await recoverSolanaAgentKeypair(encryptedSecret, {
			agentId: id, userId: ownerId, reason: `strategy_${side}`,
			meta: { mint, network, custody_event_id: claimId, strategy_id: strategyRef?.strategy_id || null },
		});
	} catch {
		await updateCustodyEvent(claimId, { status: 'failed', meta: { error: 'key_recover_failed' } }).catch(() => {});
		return { status: 'failed', code: 'key_recover_failed' };
	}

	let instructions;
	try {
		instructions = await buildTradeInstructions({ userId: ownerId, side, conn, network, mintPk, ownerPk: keypair.publicKey, quote, slippageBps, solAmount, tokenAmountRaw });
	} catch (e) {
		await updateCustodyEvent(claimId, { status: 'failed', meta: { error: 'build_failed', message: (e?.message || '').slice(0, 200) } }).catch(() => {});
		return { status: 'failed', code: 'build_failed' };
	}

	let signature;
	let confirmed = true;
	let execTelemetry = null;
	try {
		const result = await submitProtected({
			network, connection: solanaConnection(network), payer: keypair, instructions,
			opts: { tipMode: 'off', confirmTimeoutMs: 45_000 },
		});
		signature = result.signature;
		execTelemetry = { route: result.route, priority_fee_microlamports: result.priorityFeeMicroLamports, landed_ms: result.landedMs, attempts: result.attempts };
	} catch (e) {
		if (e?.code === 'TX_ERR') { signature = e.signature || null; confirmed = false; }
		else {
			await updateCustodyEvent(claimId, { status: 'failed', meta: { error: 'send_failed', message: (e?.message || '').slice(0, 200) } }).catch(() => {});
			logAudit({ userId: ownerId, action: 'custody.trade_failed', resourceId: id, meta: { side, mint, reason, strategy: strategyRef } });
			return { status: 'failed', code: 'send_failed' };
		}
	}

	if (!confirmed) {
		await updateCustodyEvent(claimId, { signature, meta: { confirm: 'unconfirmed' } }).catch(() => {});
		logAudit({ userId: ownerId, action: 'custody.trade_unconfirmed', resourceId: id, meta: { side, mint, signature, reason, strategy: strategyRef } });
		return { status: 'unconfirmed', signature, custodyEventId: claimId, usd: usdValue, priceImpact: quote.priceImpactPct, quote };
	}

	await updateCustodyEvent(claimId, { status: 'confirmed', signature, usd: side === 'buy' ? usdValue ?? null : null, meta: execTelemetry ? { exec: execTelemetry } : undefined }).catch(() => {});
	logAudit({ userId: ownerId, action: 'custody.trade', resourceId: id, meta: { side, mint, venue: quote.venue, usd: usdValue, signature, network, reason, strategy: strategyRef, exec_route: execTelemetry?.route } });
	await cacheSet(`sol:bal:${address}:${network}`, null, 1).catch(() => {});

	return { status: 'executed', signature, custodyEventId: claimId, usd: usdValue, priceImpact: quote.priceImpactPct, quote };
}

// ── entries: evaluate real launches against one equipped strategy ─────────────
// Best-effort. Opens at most `maxEntries` real positions this sweep. Records an
// open position row per confirmed buy; the unique (agent,mint,network) index and
// the custody idempotency key both prevent a double entry.
//
// Order of checks for each launch: entry filter (cheap, pure) → already held →
// research gates against a cited gate report → mode. In auto mode the buy runs
// through the full guarded path within the agent's caps; in ask mode the same
// guards run as a dry run and, if they would allow it, an approval request is
// filed for the owner instead of buying. Every candidate that clears the entry
// filter gets a decision row saying what happened and which check decided it.

// Upsert the open position for a confirmed (or unconfirmed-but-sent) entry buy.
// A fresh open position, OR revive a previously-CLOSED row for the same mint
// (re-entry after a take-profit/stop). The WHERE guard means an already-open row
// (another strategy) is never clobbered.
export async function recordEntryPosition({ equip, agentId, network, mint, symbol = null, name = null, result }) {
	const entryLamports = result.quote ? result.quote.inAtomics : null;
	const baseAmount = result.quote ? result.quote.outAtomics : null;
	await sql`
		INSERT INTO agent_strategy_positions
			(equip_id, strategy_id, agent_id, owner_id, network, mint, symbol, name, status,
			 entry_sig, entry_lamports, base_amount, entry_price_impact_pct,
			 peak_value_lamports, last_value_lamports, last_quoted_at)
		VALUES (
			${equip.id}, ${equip.strategy_id}, ${agentId}, ${equip.owner_id}, ${network},
			${mint}, ${symbol}, ${name}, 'open',
			${result.signature || null}, ${entryLamports}, ${baseAmount}, ${result.priceImpact ?? null},
			${entryLamports}, ${entryLamports}, now()
		)
		ON CONFLICT (agent_id, mint, network) DO UPDATE SET
			equip_id = excluded.equip_id, strategy_id = excluded.strategy_id, owner_id = excluded.owner_id,
			symbol = excluded.symbol, name = excluded.name, status = 'open', exit_reason = NULL,
			entry_sig = excluded.entry_sig, entry_lamports = excluded.entry_lamports,
			base_amount = excluded.base_amount, entry_price_impact_pct = excluded.entry_price_impact_pct,
			peak_value_lamports = excluded.peak_value_lamports, last_value_lamports = excluded.last_value_lamports,
			last_quoted_at = now(), exit_sig = NULL, exit_lamports = NULL,
			realized_pnl_lamports = NULL, realized_pnl_pct = NULL, error = NULL,
			opened_at = now(), closed_at = NULL
		WHERE agent_strategy_positions.status = 'closed'
	`.catch(() => {});
	await sql`
		UPDATE agent_strategy_equips
		SET last_fired_at = now(), fires_count = fires_count + 1, last_eval_at = now(), updated_at = now()
		WHERE id = ${equip.id}
	`.catch(() => {});
}

// Tag the launches an agent launched through three.ws, for entry.sources. One
// indexed query per sweep, only when the strategy filters on it.
async function tagThreeWsLaunches(launches, network) {
	const mints = launches.map((l) => l.mint).filter(Boolean);
	if (!mints.length) return launches;
	const rows = await sql`
		SELECT mint FROM pump_agent_mints WHERE network = ${network} AND mint = ANY(${mints})
	`.catch(() => []);
	const ours = new Set(rows.map((r) => r.mint));
	return launches.map((l) => (ours.has(l.mint) ? { ...l, three_ws_launch: true } : l));
}

const guardDecision = (result) => {
	if (result.status === 'executed' || result.status === 'unconfirmed') return 'executed';
	if (result.status === 'skipped') return 'skipped';
	return 'failed';
};

async function evaluateEntries({ equip, agent, launches, nowMs, maxEntries = 3 }) {
	const config = normalizeStrategyConfig(equip.config_snapshot);
	const network = netOf(equip.network);
	const results = [];

	// pump.fun's public launch feed is mainnet-only — devnet has no entries (open
	// positions there still exit via real on-chain re-quotes).
	if (network !== 'mainnet' || !launches.length) return results;

	// Cooldown — honor the strategy's minimum gap between entries.
	if (config.risk.cooldown_minutes > 0 && equip.last_fired_at) {
		const sinceMin = (nowMs - new Date(equip.last_fired_at).getTime()) / 60000;
		if (sinceMin < config.risk.cooldown_minutes) return results;
	}

	// Concurrency — never exceed the strategy's max concurrent open positions. In
	// ask mode a pending approval holds a slot too, so the owner is never asked for
	// more buys than the strategy may hold at once.
	const [openCnt] = await sql`
		SELECT count(*)::int AS n FROM agent_strategy_positions
		WHERE equip_id = ${equip.id} AND status IN ('open','closing')
	`;
	const pending = config.mode === 'ask' ? await pendingApprovalCount(equip.id) : 0;
	let room = Math.max(0, (config.risk.max_concurrent_positions || 0) - Number(openCnt?.n || 0) - pending);
	if (room <= 0) return results;

	const candidates = config.entry.sources.includes('three_ws_launch')
		? await tagThreeWsLaunches(launches, network)
		: launches;
	const gated = researchGatesActive(config);
	// A candidate decided recently is not re-researched every sweep: approvals and
	// buys are final for that coin, and a block is re-checked after a short pause
	// (holders and liquidity grow, so a coin can clear a gate later).
	const decided = await recentDecisions(equip.id, candidates.map((l) => l.mint));
	const slippageBps = config.sizing.max_slippage_bps;
	const maxPriceImpactPct = config.sizing.max_price_impact_bps == null ? null : config.sizing.max_price_impact_bps / 100;
	let opened = 0;
	for (const launchRaw of candidates) {
		if (opened >= maxEntries || room <= 0) break;
		if (decided.has(launchRaw.mint)) continue;
		const launch = { ...launchRaw };

		// Enrich creator history only when the strategy actually gates on it (one
		// upstream fetch per candidate, cached) — keeps the sweep cheap.
		if ((config.entry.max_creator_launches != null || config.entry.min_creator_graduated != null) && launch.creator_launches == null) {
			await enrichCreatorStats(launch).catch(() => {});
		}

		const verdict = matchesEntry(config, launch, nowMs);
		if (!verdict.pass) continue;

		// Already holding this mint anywhere on this agent? Don't stack. The position
		// unique key is (agent_id, mint, network), so the check must be agent-scoped —
		// an equip-scoped check would let a buy land that the position upsert can't
		// record (a closed/other-strategy row would win the conflict).
		const [held] = await sql`
			SELECT 1 FROM agent_strategy_positions
			WHERE agent_id = ${agent.id} AND mint = ${launch.mint} AND network = ${network}
			  AND status IN ('open','closing') LIMIT 1
		`;
		if (held) continue;

		const strategyRef = {
			strategy_id: equip.strategy_id, equip_id: equip.id, slug: equip.slug,
			strategy_name: equip.strategy_name, action: 'entry',
		};
		const decisionBase = { equip, agentId: agent.id, network, mint: launch.mint };

		// Research gates: build the cited report only when a gate is on or the owner
		// will be asked (the approval card shows its risk notes).
		let report = null;
		let assessment = null;
		if (gated || config.mode === 'ask') {
			({ report, assessment } = await buildGateReport({
				config, launch, network, payer: agent.address, forApproval: config.mode === 'ask',
			}));
			const evaluation = evaluateResearchGates(config, report);
			if (!evaluation.pass) {
				const first = evaluation.blocked_by[0];
				await recordCandidateDecision({
					...decisionBase, decision: 'blocked', check: first.check,
					reason: evaluation.blocked_by.map((b) => b.reason).join(' '),
					blockedBy: evaluation.blocked_by, report,
				});
				results.push({ mint: launch.mint, action: 'entry', status: 'skipped', code: 'research_blocked', check: first.check, blocked_by: evaluation.blocked_by, reasons: verdict.reasons });
				continue;
			}
			report.evaluation = evaluation;
		}

		const idem = `strategy:${equip.id}:entry:${launch.mint}`;
		const tradeArgs = {
			agent, side: 'buy', mint: launch.mint, network,
			solAmount: config.sizing.amount_sol, tokenAmountRaw: null,
			slippageBps, idempotencyKey: idem, strategyRef, maxPriceImpactPct, preAssessment: assessment,
		};

		let result;
		try {
			result = await runStrategyTrade({ ...tradeArgs, dryRun: config.mode === 'ask' });
		} catch (e) {
			result = { status: 'failed', code: (e?.message || 'error').slice(0, 120) };
		}

		// Ask mode: the guards would allow this buy, so ask the owner instead of buying.
		if (result.status === 'ready') {
			const approval = await createStrategyApproval({
				equip, agent, config, launch, network, quote: result.quote, usd: result.usd,
				impactCap: result.impactCap, idempotencyKey: idem, report,
			});
			if (approval.ok) {
				await recordCandidateDecision({
					...decisionBase, decision: 'approval', check: 'mode_ask',
					reason: approval.created ? 'Ask mode: an approval request is waiting for the owner.' : 'Ask mode: already asked about this coin.',
					report, approvalId: approval.id,
				});
				results.push({ mint: launch.mint, action: 'entry', status: 'approval', approval_id: approval.id, created: approval.created, reasons: verdict.reasons });
				if (approval.created) room -= 1;
			} else {
				await recordCandidateDecision({
					...decisionBase, decision: 'failed', check: 'approval_unavailable',
					reason: 'Ask mode could not file an approval request, so nothing was bought.', report,
				});
				results.push({ mint: launch.mint, action: 'entry', status: 'failed', code: 'approval_unavailable', reasons: verdict.reasons });
			}
			continue;
		}

		await recordCandidateDecision({
			...decisionBase, decision: guardDecision(result), check: result.code || (result.status === 'executed' ? 'mode_auto' : null),
			reason: result.status === 'executed' || result.status === 'unconfirmed'
				? 'Auto mode: bought within the agent’s caps.'
				: (STRATEGY_SKIP_LABELS[result.code] || result.message || result.code || 'trade did not complete'),
			report, signature: result.signature || null,
		});
		results.push({ mint: launch.mint, action: 'entry', ...result, reasons: verdict.reasons });

		// Surface a SAFETY refusal (mayhem coin, rug/honeypot firewall) on the
		// public live tape — the platform declining a bad buy is a trust signal
		// worth showing, not hiding. Routine skips (cooldown, cap) stay quiet.
		if (result.status === 'skipped' && (result.code === 'mayhem' || result.code === 'firewall_blocked')) {
			pushGuardEvent({
				actor: agent.name, agentId: agent.id, mint: launch.mint, reason: result.code,
				label: result.code === 'mayhem' ? 'skipped a pump.fun mayhem coin' : 'blocked a buy at the rug/honeypot firewall',
			});
		}

		if (result.status === 'executed' || result.status === 'unconfirmed') {
			await recordEntryPosition({ equip, agentId: agent.id, network, mint: launch.mint, symbol: launch.symbol || null, name: launch.name || null, result });
			opened += 1;
			room -= 1;
		}
	}
	return results;
}

// ── exits: re-quote every open position, close on TP/SL/trailing/timeout ───────
// 100% real: the live value is a real quoteTrade(sell) of the agent's REAL on-chain
// token balance; the exit is a real sell of that balance through the guarded path.
async function evaluateExits({ equip, agent, nowMs, killed }) {
	const network = netOf(equip.network);
	const config = normalizeStrategyConfig(equip.config_snapshot);
	const results = [];

	const positions = await sql`
		SELECT * FROM agent_strategy_positions
		WHERE equip_id = ${equip.id} AND status IN ('open','closing') AND network = ${network}
		ORDER BY opened_at ASC
	`;
	if (!positions.length) return results;

	const conn = solanaConnection(network);
	let ownerPk = null;
	try { ownerPk = new PublicKey(agent.address); } catch { return results; }

	for (const pos of positions) {
		const mintPk = new PublicKey(pos.mint);
		const { raw } = await readTokenBalance(conn, ownerPk, mintPk);

		// The agent no longer holds the token (sold elsewhere / dust) — reconcile the
		// row closed against real chain state rather than leaving a ghost position.
		if (raw <= 0n) {
			await sql`
				UPDATE agent_strategy_positions
				SET status = 'closed', exit_reason = 'manual', closed_at = now()
				WHERE id = ${pos.id} AND status IN ('open','closing')
			`.catch(() => {});
			results.push({ mint: pos.mint, action: 'reconcile', status: 'closed', reason: 'no_holding' });
			continue;
		}

		// Live value = a real re-quote of selling the whole holding.
		let curValue = null;
		try {
			const q = await quoteTrade({ conn, side: 'sell', mintPk, mintStr: pos.mint, network, solAmount: null, tokenAmountRaw: raw.toString(), slippageBps: config.sizing.max_slippage_bps });
			curValue = Number(q.outAtomics);
		} catch { curValue = pos.last_value_lamports != null ? Number(pos.last_value_lamports) : null; }

		if (curValue != null) {
			const peak = Math.max(Number(pos.peak_value_lamports || 0), curValue);
			await sql`
				UPDATE agent_strategy_positions
				SET last_value_lamports = ${curValue}, peak_value_lamports = ${peak}, last_quoted_at = now()
				WHERE id = ${pos.id}
			`.catch(() => {});
			pos.peak_value_lamports = peak;
		}

		// While the kill switch is engaged, keep marking-to-market (so the owner sees
		// live value) but never initiate an exit trade — the leash halts ALL strategy
		// trading. The owner retains manual control via the discretionary endpoint.
		if (killed) { results.push({ mint: pos.mint, action: 'hold', status: 'killed' }); continue; }

		const decision = shouldExit(config, {
			entry_lamports: pos.entry_lamports, peak_value_lamports: pos.peak_value_lamports, opened_at: new Date(pos.opened_at).getTime(),
		}, curValue, nowMs);
		if (!decision.exit) continue;

		const idem = `strategy:${equip.id}:exit:${pos.mint}:${pos.id}`;
		const strategyRef = {
			strategy_id: equip.strategy_id, equip_id: equip.id, slug: equip.slug,
			strategy_name: equip.strategy_name, action: 'exit', exit_reason: decision.reason,
		};
		await sql`UPDATE agent_strategy_positions SET status = 'closing' WHERE id = ${pos.id} AND status = 'open'`.catch(() => {});

		let result;
		try {
			result = await runStrategyTrade({
				agent, side: 'sell', mint: pos.mint, network,
				solAmount: null, tokenAmountRaw: raw.toString(),
				slippageBps: config.sizing.max_slippage_bps, idempotencyKey: idem, strategyRef,
			});
		} catch (e) {
			result = { status: 'failed', code: (e?.message || 'error').slice(0, 120) };
		}

		results.push({ mint: pos.mint, action: 'exit', reason: decision.reason, ...result });

		if (result.status === 'executed' || result.status === 'unconfirmed') {
			const exitLamports = result.quote ? Number(result.quote.outAtomics) : null;
			const entryLamports = pos.entry_lamports != null ? Number(pos.entry_lamports) : null;
			const pnl = exitLamports != null && entryLamports != null ? exitLamports - entryLamports : null;
			const pnlPct = pnl != null && entryLamports > 0 ? (pnl / entryLamports) * 100 : null;
			await sql`
				UPDATE agent_strategy_positions
				SET status = 'closed', exit_reason = ${decision.reason}, exit_sig = ${result.signature || null},
				    exit_lamports = ${exitLamports}, realized_pnl_lamports = ${pnl}, realized_pnl_pct = ${pnlPct},
				    closed_at = now()
				WHERE id = ${pos.id}
			`.catch(() => {});
		} else {
			// Exit failed to land — drop back to 'open' so the next sweep retries.
			await sql`UPDATE agent_strategy_positions SET status = 'open', error = ${result.code || 'exit_failed'} WHERE id = ${pos.id} AND status = 'closing'`.catch(() => {});
		}
	}
	return results;
}

// ── public: force-close ONE open position now (owner "Sell now") ──────────────
// The per-position manual lever behind the Trading Brain's "Sell now". It mirrors
// the exit branch of evaluateExits exactly — atomically claim (open → closing),
// size the sell from the REAL on-chain holding, sell through the SAME guarded
// runStrategyTrade path, then write realized PnL and flip the row to 'closed' — so
// a manual exit and an automatic take-profit/stop can never drift. Owner-scoped by
// owner_id. Selling moves SOL inward, so (like every sell path) it is intentionally
// NOT blocked by the kill switch or spend caps — getting out is always safe.
export async function closeStrategyPositionNow({ positionId, ownerId, agentId }) {
	const reopen = (id, errCode) =>
		sql`UPDATE agent_strategy_positions SET status = 'open', error = ${errCode} WHERE id = ${id} AND status = 'closing'`.catch(() => {});

	// Atomically CLAIM the open position. The flip both authorizes the caller (no
	// row → not theirs / not open) and serializes against the worker's own sweep:
	// only the txn that finds it still 'open' wins, so no double-sell of one bag.
	const [claim] = await sql`
		UPDATE agent_strategy_positions
		SET status = 'closing'
		WHERE id = ${positionId} AND agent_id = ${agentId} AND owner_id = ${ownerId} AND status = 'open'
		RETURNING id, equip_id, strategy_id, mint, symbol, name, network, entry_lamports
	`;
	if (!claim) {
		const [existing] = await sql`
			SELECT status FROM agent_strategy_positions
			WHERE id = ${positionId} AND agent_id = ${agentId} AND owner_id = ${ownerId} LIMIT 1
		`;
		if (!existing) return { ok: false, status: 404, code: 'not_found', message: 'no open position found for that agent' };
		if (existing.status === 'closing') return { ok: false, status: 409, code: 'position_busy', message: 'this position is already being closed — give it a moment' };
		if (existing.status === 'closed') return { ok: false, status: 409, code: 'already_closed', message: 'this position is already closed' };
		return { ok: false, status: 409, code: 'not_open', message: 'this position is not open' };
	}

	const network = netOf(claim.network);
	const agent = await loadAgent(agentId);
	if (!agent?.address || !agent.encryptedSecret) {
		await reopen(claim.id, 'wallet_preparing');
		return { ok: false, status: 409, code: 'wallet_preparing', message: 'the agent wallet is still provisioning — try again' };
	}

	// Slippage from the equipping strategy's config — the same value an auto-exit uses.
	const [equip] = await sql`
		SELECT e.config_snapshot, e.slug, e.strategy_id, s.name AS strategy_name
		FROM agent_strategy_equips e JOIN agent_strategies s ON s.id = e.strategy_id
		WHERE e.id = ${claim.equip_id} LIMIT 1
	`.catch(() => []);
	const config = normalizeStrategyConfig(equip?.config_snapshot || {});
	const slippageBps = config.sizing?.max_slippage_bps ?? 500;

	const conn = solanaConnection(network);
	let ownerPk; let mintPk;
	try { ownerPk = new PublicKey(agent.address); mintPk = new PublicKey(claim.mint); }
	catch { await reopen(claim.id, 'bad_address'); return { ok: false, status: 400, code: 'bad_address', message: 'invalid wallet or mint address' }; }

	const { raw } = await readTokenBalance(conn, ownerPk, mintPk);
	if (raw <= 0n) {
		// Nothing to sell — reconcile the row closed against real chain state rather
		// than stranding it in 'closing'.
		await sql`UPDATE agent_strategy_positions SET status = 'closed', exit_reason = 'manual', closed_at = now() WHERE id = ${claim.id} AND status = 'closing'`.catch(() => {});
		return { ok: true, status: 200, data: { status: 'closed', mint: claim.mint, symbol: claim.symbol || null, reconciled: true, pnl_sol: null } };
	}

	const idem = `strategy:${claim.equip_id}:manual_exit:${claim.mint}:${claim.id}`;
	const strategyRef = {
		strategy_id: claim.strategy_id, equip_id: claim.equip_id, slug: equip?.slug || null,
		strategy_name: equip?.strategy_name || null, action: 'exit', exit_reason: 'manual',
	};

	let result;
	try {
		result = await runStrategyTrade({
			agent, side: 'sell', mint: claim.mint, network,
			solAmount: null, tokenAmountRaw: raw.toString(),
			slippageBps, idempotencyKey: idem, strategyRef,
		});
	} catch (e) {
		await reopen(claim.id, 'manual_close_failed');
		return { ok: false, status: 502, code: 'sell_failed', message: 'the sell could not be submitted and no funds were moved — try again' };
	}

	if (result.status === 'executed' || result.status === 'unconfirmed') {
		const exitLamports = result.quote ? Number(result.quote.outAtomics) : null;
		const entryLamports = claim.entry_lamports != null ? Number(claim.entry_lamports) : null;
		const pnl = exitLamports != null && entryLamports != null ? exitLamports - entryLamports : null;
		const pnlPct = pnl != null && entryLamports > 0 ? (pnl / entryLamports) * 100 : null;
		await sql`
			UPDATE agent_strategy_positions
			SET status = 'closed', exit_reason = 'manual', exit_sig = ${result.signature || null},
			    exit_lamports = ${exitLamports}, realized_pnl_lamports = ${pnl}, realized_pnl_pct = ${pnlPct}, closed_at = now()
			WHERE id = ${claim.id}
		`.catch(() => {});
		return {
			ok: true, status: 200,
			data: {
				status: 'closed', mint: claim.mint, symbol: claim.symbol || null,
				pnl_sol: pnl != null ? pnl / 1e9 : null, pnl_pct: pnlPct,
				signature: result.signature || null, unconfirmed: result.status === 'unconfirmed',
			},
		};
	}

	// Sell didn't land — reopen so the next worker sweep (or a retry) can exit.
	await reopen(claim.id, result.code || 'exit_failed');
	if (result.status === 'skipped') return { ok: false, status: 409, code: result.code || 'skipped', message: `the sell was skipped (${result.code || 'unknown'}) — the position is still open` };
	return { ok: false, status: 502, code: 'sell_failed', message: `the sell did not complete (${result.code || result.status}) — the position is still open` };
}

// ── ask mode: run or refuse an approved strategy buy ──────────────────────────
// The owner approved exactly the buy in `row.payload`. Re-check that the strategy
// can still trade (equip active, strategy not deleted, owner kill switch off, coin
// not already held), then run it through the SAME guarded path an auto-mode buy
// takes, with the same idempotency key, so every cap, the price-impact breaker,
// and the firewall apply at the moment of execution, not at the moment of asking.
// Exported so the shared approval inbox can dispatch action_type 'strategy_buy'.
export async function runApprovedStrategyBuy(row) {
	const p = row.payload || {};
	const [equip] = await sql`
		SELECT e.id, e.strategy_id, e.agent_id, e.owner_id, e.active, e.network, s.slug, s.name AS strategy_name
		FROM agent_strategy_equips e
		JOIN agent_strategies s ON s.id = e.strategy_id AND s.deleted_at IS NULL
		WHERE e.id = ${p.equip_id} AND e.agent_id = ${p.agent_id}
		LIMIT 1
	`;
	if (!equip) return { status: 'failed', code: 'strategy_gone' };
	if (!equip.active) return { status: 'failed', code: 'equip_inactive' };
	const killed = await engagedKillOwners();
	if (killed.has(equip.owner_id)) return { status: 'skipped', code: 'owner_kill' };

	const agent = await loadAgent(p.agent_id);
	if (!agent || agent.ownerId !== row.user_id) return { status: 'failed', code: 'agent_missing' };
	const network = netOf(p.network);
	const [held] = await sql`
		SELECT 1 FROM agent_strategy_positions
		WHERE agent_id = ${agent.id} AND mint = ${p.mint} AND network = ${network} AND status IN ('open','closing') LIMIT 1
	`;
	if (held) return { status: 'skipped', code: 'already_held' };

	const result = await runStrategyTrade({
		agent, side: 'buy', mint: p.mint, network,
		solAmount: Number(p.amount_sol), tokenAmountRaw: null,
		slippageBps: Number(p.slippage_bps), idempotencyKey: p.idempotency_key,
		maxPriceImpactPct: p.max_price_impact_pct == null ? null : Number(p.max_price_impact_pct),
		strategyRef: {
			strategy_id: equip.strategy_id, equip_id: equip.id, slug: equip.slug,
			strategy_name: equip.strategy_name, action: 'entry', approval_id: row.id,
		},
	});
	if (result.status === 'executed' || result.status === 'unconfirmed') {
		await recordEntryPosition({ equip, agentId: agent.id, network, mint: p.mint, result });
	}
	await recordCandidateDecision({
		equip, agentId: agent.id, network, mint: p.mint,
		decision: guardDecision(result), check: result.code || 'owner_approved',
		reason: result.status === 'executed' || result.status === 'unconfirmed'
			? 'Approved by the owner and bought within the agent’s caps.'
			: `Approved, but ${STRATEGY_SKIP_LABELS[result.code] || result.code || 'the trade did not complete'}.`,
		approvalId: row.id, signature: result.signature || null,
	});
	return result;
}

/**
 * The shared approval inbox's executor contract (api/_lib/approvals.js):
 * executor(row) -> { status: 'ok'|'error'|'skipped', signature?, note?, usd? }.
 * Approving a strategy buy from /approvals runs the same guarded path as
 * approving it from the agent's strategy panel.
 */
export async function executeApprovedStrategyAction(row) {
	const r = await runApprovedStrategyBuy(row);
	const done = r.status === 'executed' || r.status === 'unconfirmed';
	const label = r.code ? (STRATEGY_SKIP_LABELS[r.code] || r.code) : null;
	return {
		status: done ? 'ok' : r.status === 'skipped' ? 'skipped' : 'error',
		signature: r.signature || null,
		usd: r.usd ?? null,
		note: done ? (r.status === 'unconfirmed' ? 'Sent; confirmation is still pending on-chain.' : 'Bought within the agent’s caps.') : `Nothing was bought: ${label || 'the trade did not complete'}.`,
	};
}

/**
 * Approve one strategy approval request and execute it once.
 * The caller must echo the payload hash it showed the owner.
 * Returns { ok, status, code?, approval } with an HTTP-ready `http` status.
 */
export async function approveStrategyRequest({ id, ownerId, agentId, shownHash, via = 'web' }) {
	const [row] = await sql`
		SELECT * FROM approval_requests
		WHERE id = ${id} AND user_id = ${ownerId} AND agent_id = ${agentId} AND source = ${STRATEGY_APPROVAL_SOURCE}
		LIMIT 1
	`;
	if (!row) return { ok: false, http: 404, code: 'not_found', message: 'approval request not found' };
	// Already decided: a second tap (push plus web, a double click) is a no-op that
	// reports the outcome of the first.
	if (row.status !== 'pending') return { ok: true, http: 200, already: true, approval: publicApproval(row) };
	if (!shownHash || shownHash !== row.payload_hash) {
		return { ok: false, http: 409, code: 'payload_mismatch', message: 'This request changed since you opened it. Reload and review it again.' };
	}
	if (payloadHash(row.payload) !== row.payload_hash) {
		await sql`UPDATE approval_requests SET status = 'failed', result = ${JSON.stringify({ code: 'payload_tampered' })}::jsonb, updated_at = now() WHERE id = ${id} AND status = 'pending'`;
		return { ok: false, http: 409, code: 'payload_tampered', message: 'The stored request does not match its signature, so it was refused.' };
	}
	if (new Date(row.expires_at).getTime() <= Date.now()) {
		await sql`UPDATE approval_requests SET status = 'expired', updated_at = now() WHERE id = ${id} AND status = 'pending'`;
		return { ok: false, http: 410, code: 'expired', message: 'This request expired before it was approved. Nothing was bought.' };
	}

	// The single conditional step: exactly one caller moves pending -> approved.
	const claimed = await sql`
		UPDATE approval_requests
		SET status = 'executing', decided_by = ${ownerId}, decided_at = now(), decided_via = ${via}, updated_at = now()
		WHERE id = ${id} AND status = 'pending' AND expires_at > now()
		RETURNING *
	`;
	if (!claimed.length) {
		const [now] = await sql`SELECT * FROM approval_requests WHERE id = ${id}`;
		return { ok: true, http: 200, already: true, approval: publicApproval(now) };
	}

	let result;
	try {
		result = await runApprovedStrategyBuy(claimed[0]);
	} catch (e) {
		result = { status: 'failed', code: (e?.message || 'error').slice(0, 120) };
	}
	const done = result.status === 'executed' || result.status === 'unconfirmed';
	const summary = { status: result.status, code: result.code || null, label: result.code ? (STRATEGY_SKIP_LABELS[result.code] || null) : null, price_impact_pct: result.priceImpact ?? null, usd: result.usd ?? null };
	const [final] = await sql`
		UPDATE approval_requests
		SET status = ${done ? 'executed' : 'failed'}, executed_at = ${done ? new Date().toISOString() : null},
		    signature = ${result.signature || null}, result = ${JSON.stringify(summary)}::jsonb, updated_at = now()
		WHERE id = ${id}
		RETURNING *
	`;
	logAudit({ userId: ownerId, action: 'strategy.approval_approved', resourceId: agentId, meta: { approval_id: id, mint: row.payload?.mint, status: result.status, code: result.code || null, signature: result.signature || null, via } });
	return { ok: done, http: done ? 200 : 422, code: done ? null : result.code, message: done ? null : (STRATEGY_SKIP_LABELS[result.code] || 'the buy did not complete'), approval: publicApproval(final) };
}

/** Deny one pending strategy approval. Nothing is bought; the coin is not asked about again. */
export async function denyStrategyRequest({ id, ownerId, agentId, via = 'web' }) {
	const denied = await sql`
		UPDATE approval_requests
		SET status = 'denied', decided_by = ${ownerId}, decided_at = now(), decided_via = ${via}, updated_at = now()
		WHERE id = ${id} AND user_id = ${ownerId} AND agent_id = ${agentId} AND source = ${STRATEGY_APPROVAL_SOURCE} AND status = 'pending'
		RETURNING *
	`;
	if (!denied.length) {
		const [row] = await sql`SELECT * FROM approval_requests WHERE id = ${id} AND user_id = ${ownerId} AND agent_id = ${agentId} AND source = ${STRATEGY_APPROVAL_SOURCE}`;
		if (!row) return { ok: false, http: 404, code: 'not_found', message: 'approval request not found' };
		return { ok: true, http: 200, already: true, approval: publicApproval(row) };
	}
	const row = denied[0];
	const [equip] = await sql`SELECT id, strategy_id, owner_id FROM agent_strategy_equips WHERE id = ${row.payload?.equip_id}`.catch(() => []);
	if (equip) {
		await recordCandidateDecision({
			equip, agentId, network: netOf(row.network), mint: row.payload?.mint,
			decision: 'skipped', check: 'owner_denied', reason: 'The owner denied this buy.', approvalId: row.id,
		});
	}
	logAudit({ userId: ownerId, action: 'strategy.approval_denied', resourceId: agentId, meta: { approval_id: id, mint: row.payload?.mint, via } });
	return { ok: true, http: 200, approval: publicApproval(row) };
}

function publicApproval(row) {
	if (!row) return null;
	return {
		id: row.id, status: row.status, summary: row.summary, payload: row.payload, payload_hash: row.payload_hash,
		amount: row.amount != null ? Number(row.amount) : null, amount_usd: row.amount_usd != null ? Number(row.amount_usd) : null,
		asset: row.asset, chain: row.chain, network: row.network, recipient: row.recipient, recipient_label: row.recipient_label,
		risk_notes: row.risk_notes || [], expires_at: row.expires_at, decided_at: row.decided_at,
		executed_at: row.executed_at, signature: row.signature, result: row.result, created_at: row.created_at,
	};
}

// ── public: evaluate one equip (exits first, then entries) ────────────────────
export async function evaluateEquip(equip, { launches = null, nowMs = null, killed = false, maxEntries = 3 } = {}) {
	const now = nowMs ?? Date.now();
	const agent = await loadAgent(equip.agent_id);
	if (!agent) return { equip_id: equip.id, error: 'agent_missing', results: [] };
	if (!agent.address || !agent.encryptedSecret) {
		await sql`UPDATE agent_strategy_equips SET last_eval_at = now() WHERE id = ${equip.id}`.catch(() => {});
		return { equip_id: equip.id, error: 'wallet_preparing', results: [] };
	}

	const out = [];
	// Exits ALWAYS run (mark-to-market + close) so positions are managed even on a
	// sweep with no fresh launches.
	const exits = await evaluateExits({ equip, agent, nowMs: now, killed });
	out.push(...exits);

	// Entries only when not killed and the equip is active.
	if (!killed && equip.active) {
		const feed = launches ?? await recentPumpLaunches({ network: netOf(equip.network), limit: 50 }).catch(() => []);
		const entries = await evaluateEntries({ equip, agent, launches: feed, nowMs: now, maxEntries });
		out.push(...entries);
	}

	await sql`UPDATE agent_strategy_equips SET last_eval_at = now() WHERE id = ${equip.id}`.catch(() => {});
	return { equip_id: equip.id, results: out };
}

// ── public: a never-throwing launch-feed read (devnet → [], outage → []) ──────
export async function recentPumpLaunchesSafe(network = 'mainnet') {
	if (netOf(network) !== 'mainnet') return [];
	return recentPumpLaunches({ network: 'mainnet', limit: 50 }).catch(() => []);
}

// ── public: the per-owner global kill set ─────────────────────────────────────
export async function engagedKillOwners() {
	const rows = await sql`SELECT owner_id FROM strategy_kill_switch WHERE engaged = true`.catch(() => []);
	return new Set(rows.map((r) => r.owner_id));
}

// ── public: sweep every active equip on a network (cron + owner "Run now") ─────
// Pulls the real launch feed ONCE and shares it across every equip on the network,
// so a fanout of N equips makes one upstream feed call, not N. Bounded so a short
// cron can never run away.
export async function sweepStrategies({ network = 'mainnet', maxEquips = 200, maxEntriesPerEquip = 3 } = {}) {
	const net = netOf(network);
	const nowMs = Date.now();

	const equips = await sql`
		SELECT e.id, e.strategy_id, e.agent_id, e.owner_id, e.config_snapshot, e.strategy_version,
		       e.network, e.active, e.last_fired_at, e.last_eval_at,
		       s.slug, s.name AS strategy_name
		FROM agent_strategy_equips e
		JOIN agent_strategies s ON s.id = e.strategy_id AND s.deleted_at IS NULL
		JOIN agent_identities a ON a.id = e.agent_id AND a.deleted_at IS NULL
		WHERE e.active = true AND e.network = ${net}
		ORDER BY e.last_eval_at ASC NULLS FIRST
		LIMIT ${maxEquips}
	`;
	if (!equips.length) return { network: net, equips: 0, results: [] };

	const killed = await engagedKillOwners();
	const launches = net === 'mainnet' ? await recentPumpLaunches({ network: net, limit: 50 }).catch(() => []) : [];

	const stats = { executed: 0, skipped: 0, failed: 0, unconfirmed: 0, closed: 0, approval: 0 };
	let evaluated = 0;
	for (const equip of equips) {
		try {
			const r = await evaluateEquip(equip, { launches, nowMs, killed: killed.has(equip.owner_id), maxEntries: maxEntriesPerEquip });
			evaluated += 1;
			for (const res of r.results) {
				if (res.status && stats[res.status] != null) stats[res.status] += 1;
				if (res.action === 'reconcile' && res.status === 'closed') stats.closed += 1;
			}
		} catch (e) {
			stats.failed += 1;
			stats.last_error = (e?.message || 'error').slice(0, 160);
		}
	}
	return { network: net, equips: evaluated, ...stats };
}
