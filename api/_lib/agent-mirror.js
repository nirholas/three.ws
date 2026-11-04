// Custodial mirror executor — turns a leader agent's REAL on-chain trade into a
// follower agent's REAL, server-signed mirror trade, within the follower's spend
// policy and fully audited.
//
// Safe by construction: every mirrored buy runs through the SAME shared spend
// guardrails (api/_lib/agent-trade-guards.js) the discretionary trade endpoint
// and the sniper use, the SAME pump quote + instruction builders
// (api/agents/solana-trade.js), the SAME MEV-aware execution engine, and lands
// in the SAME custody ledger (agent_custody_events, category 'trade', reason
// 'mirror', meta.mirror = { leader… }). It can NEVER bypass a limit:
//   • the mirror kill switch (agent meta.mirror_killed) and the per-follow
//     `enabled` flag both halt it before any tx;
//   • the per-trade cap, rolling daily budget, USD ceiling, price-impact breaker,
//     rug/honeypot firewall, and SOL headroom all gate the buy;
//   • a retried (follow, leader-trade) never double-spends — the custody
//     idempotency key and the agent_mirror_fills unique index both dedupe it.
//
// Detection source: the leader's confirmed custody trade rows — real signatures,
// real amounts, real mints. A leader is itself an ownable three.ws agent, so its
// trades are captured here with full fidelity (side/mint/size) the moment they
// confirm on-chain.

import { PublicKey } from '@solana/web3.js';
import { sql } from './db.js';
import { planMirror } from './mirror-engine.js';
import { quoteTrade, buildTradeInstructions } from '../agents/solana-trade.js';
import { feeEventFromDisclosure } from './platform-fee-events.js';
import { recoverSolanaAgentKeypair } from './agent-wallet.js';
import { solanaConnection, solanaPublicConnection } from './agent-pumpfun.js';
import { submitProtected } from './execution-engine.js';
import { assessTradeSafety, recordFirewallDecision } from './trade-firewall.js';
import { logAudit } from './audit.js';
import { cacheSet } from './cache.js';
import { WSOL_MINT } from './pump-trade-args.js';
import {
	getSpendLimits, getTradeLimits, enforceSpendLimit, SpendLimitError, lamportsToUsd,
	getDailySpendLamports, updateCustodyEvent,
	checkPerTradeCap, checkDailyBudgetLamports, checkSolHeadroom, checkPriceImpact,
	SOL_FEE_HEADROOM_LAMPORTS,
} from './agent-trade-guards.js';

const LAMPORTS_PER_SOL = 1_000_000_000;
const DEFAULT_MIRROR_SLIPPAGE_BPS = 300;
const lamToSol = (l) => Number(BigInt(l)) / LAMPORTS_PER_SOL;

function netOf(v) { return v === 'devnet' ? 'devnet' : 'mainnet'; }

// ── detection ────────────────────────────────────────────────────────────────
// A leader's real trades from the confirmed custody ledger. `sinceId` is the
// follow's cursor so we never reprocess. Buys carry the SOL spend in
// amount_lamports; sells carry the token side (we mirror the exit, not the size).
export async function detectLeaderTrades(leaderId, network, sinceId = 0, limit = 50) {
	const rows = await sql`
		select id, asset, amount_lamports, amount_raw, usd, signature, created_at, meta
		from agent_custody_events
		where agent_id = ${leaderId}
		  and network = ${network}
		  and category = 'trade'
		  and status = 'confirmed'
		  and id > ${sinceId}
		order by id asc
		limit ${limit}
	`;
	return rows.map((e) => {
		const side = e.meta?.side || (e.asset === 'SOL' ? 'buy' : 'sell');
		return {
			eventId: Number(e.id),
			side: side === 'sell' ? 'sell' : 'buy',
			mint: e.meta?.mint || (e.asset !== 'SOL' ? e.asset : null),
			leaderSol: side === 'buy' && e.amount_lamports != null ? lamToSol(e.amount_lamports) : null,
			leaderUsd: e.usd != null ? Number(e.usd) : null,
			signature: e.signature || null,
			createdAt: e.created_at,
		};
	}).filter((t) => t.mint);
}

// Spendable SOL of the follower wallet (best-effort; null when RPC is down so the
// engine can still size fixed/proportional buys and the on-chain headroom check
// remains the hard backstop).
async function readSol(conn, ownerPk, network) {
	try { return lamToSol(BigInt(await conn.getBalance(ownerPk, 'confirmed'))); }
	catch {
		try { return lamToSol(BigInt(await solanaPublicConnection(network).getBalance(ownerPk, 'confirmed'))); }
		catch { return null; }
	}
}

// The follower's full token balance for a mint (used to size the mirrored EXIT —
// when the leader sells, the follower sells everything it holds of that coin).
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

// ── follower agent loader ─────────────────────────────────────────────────────
// Exported so other guarded auto-trade surfaces (the signal marketplace) reuse
// the exact same follower shape + kill-switch read rather than re-deriving it.
export async function loadFollower(followerId) {
	const [row] = await sql`
		SELECT id, user_id, name, meta FROM agent_identities WHERE id = ${followerId} AND deleted_at IS NULL
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
		killed: meta.mirror_killed === true,
	};
}

// ── the guarded follower trade ────────────────────────────────────────────────
// The SAME guard sequence as handleTrade (api/agents/solana-trade.js), composed
// for a server-initiated mirror. Returns a structured result — never throws past
// the boundary. `leaderRef` labels the custody trail + audit ("mirrored from X").
//
// Exported so the signal marketplace (api/_lib/signal-engine.js) auto-mirrors a
// paid emission through this identical firewall + MEV + spend-guard + custody
// pipeline — the gate is shared, never reimplemented.
export async function runFollowerTrade({
	follower, side, mint, network, solAmount, tokenAmountRaw, slippageBps, idempotencyKey, leaderRef,
	firewallLevel = 'block',
}) {
	const { id, ownerId, meta, address, encryptedSecret } = follower;
	if (!address || !encryptedSecret) return { status: 'failed', code: 'wallet_preparing' };

	let mintPk; let ownerPk;
	try { mintPk = new PublicKey(mint); ownerPk = new PublicKey(address); }
	catch { return { status: 'failed', code: 'bad_address' }; }
	if (mint === WSOL_MINT) return { status: 'skipped', code: 'wsol' };

	const conn = solanaConnection(network);

	// 1. Quote (real pump curve / AMM pricing).
	let quote;
	try {
		quote = await quoteTrade({ conn, side, mintPk, mintStr: mint, network, solAmount, tokenAmountRaw, slippageBps });
	} catch (e) {
		if (e?.code === 'pool_not_found') return { status: 'skipped', code: 'no_market' };
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
			// owner's English rules govern this mirrored trade too.
			await enforceSpendLimit({ agentId: id, meta, limits: limitsCfg, category: 'trade', usdValue, asset: 'SOL', network });
		} catch (e) {
			if (e instanceof SpendLimitError) return { status: 'skipped', code: e.code };
			throw e;
		}
	}

	if (checkPriceImpact(quote.priceImpactPct, tradeLimits.max_price_impact_pct)) {
		return { status: 'skipped', code: 'price_impact' };
	}

	// 3. Rug/honeypot firewall — buys only, the unsafe direction. A 'block' verdict
	//    refuses the mirror (degrades to allow when a source is down, never stalls).
	if (side === 'buy') {
		const assessment = await assessTradeSafety({
			network, mint: mintPk, side: 'buy', payer: ownerPk,
			quoteAmount: BigInt(quote.inAtomics), priceImpactPct: quote.priceImpactPct,
		}).catch(() => null);
		if (assessment) {
			// Honour the caller's firewall level: 'block' refuses a block-verdict
			// trade (the safe default every mirror uses); 'warn' records the verdict
			// but lets the trade through. A down firewall degrades to allow, never stalls.
			const enforced = firewallLevel === 'block' && assessment.verdict === 'block';
			recordFirewallDecision({
				mint, network, side: 'buy', verdict: assessment.verdict, score: assessment.score,
				simulated: assessment.simulated, checks: assessment.checks, reasons: assessment.reasons,
				source: 'mirror', agentId: id, userId: ownerId,
				quoteLamports: BigInt(quote.inAtomics), enforced,
			}).catch(() => {});
			if (enforced) return { status: 'skipped', code: 'firewall_blocked' };
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

	// 5. Idempotency claim in the custody ledger (also the spend row). A retry with
	//    the same key replays instead of double-spending.
	const [prior] = await sql`
		SELECT status, signature, id FROM agent_custody_events
		WHERE agent_id = ${id} AND idempotency_key = ${idempotencyKey} LIMIT 1
	`;
	if (prior) {
		if (prior.status === 'confirmed' && prior.signature) {
			return { status: 'executed', signature: prior.signature, custodyEventId: Number(prior.id), usd: usdValue, priceImpact: quote.priceImpactPct, replayed: true };
		}
		if (prior.status === 'pending') return { status: 'failed', code: 'in_flight' };
		return { status: 'failed', code: 'prior_failed' };
	}

	const mirrorMeta = {
		side, mint, venue: quote.venue, reason: 'mirror',
		expected_out_atomics: quote.outAtomics, min_out_atomics: quote.minOutAtomics,
		slippage_bps: slippageBps, price_impact_pct: quote.priceImpactPct,
		mirror: leaderRef,
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
			'pending', 'mirror', ${idempotencyKey},
			${JSON.stringify(mirrorMeta)}::jsonb
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
			agentId: id, userId: ownerId, reason: `mirror_${side}`,
			meta: { mint, network, custody_event_id: claimId, leader_agent_id: leaderRef?.leader_agent_id || null },
		});
	} catch {
		await updateCustodyEvent(claimId, { status: 'failed', meta: { error: 'key_recover_failed' } }).catch(() => {});
		return { status: 'failed', code: 'key_recover_failed' };
	}

	let instructions;
	let feeDisclosure = null;
	try {
		instructions = await buildTradeInstructions({ userId: ownerId, side, conn, network, mintPk, ownerPk: keypair.publicKey, quote, slippageBps, solAmount, tokenAmountRaw, onFee: (d) => { feeDisclosure = d; } });
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
			logAudit({ userId: ownerId, action: 'custody.trade_failed', resourceId: id, meta: { side, mint, reason: 'mirror_send_failed', leader: leaderRef } });
			return { status: 'failed', code: 'send_failed' };
		}
	}

	if (!confirmed) {
		await updateCustodyEvent(claimId, { signature, meta: { confirm: 'unconfirmed' } }).catch(() => {});
		logAudit({ userId: ownerId, action: 'custody.trade_unconfirmed', resourceId: id, meta: { side, mint, signature, reason: 'mirror', leader: leaderRef } });
		return { status: 'unconfirmed', signature, custodyEventId: claimId, usd: usdValue, priceImpact: quote.priceImpactPct };
	}

	await updateCustodyEvent(claimId, {
		status: 'confirmed',
		signature,
		usd: side === 'buy' ? usdValue ?? null : null,
		meta: execTelemetry ? { exec: execTelemetry } : undefined,
		platformFee: feeEventFromDisclosure({
			disclosure: feeDisclosure,
			signature,
			source: 'agent_trade',
			network,
			payer: address,
			userId: ownerId,
			agentId: id,
			meta: { mint, side, venue: quote.venue, custody_event_id: claimId, source: 'agent_mirror', leader_agent_id: leaderRef?.leader_agent_id || null },
		}),
	}).catch(() => {});
	logAudit({ userId: ownerId, action: 'custody.trade', resourceId: id, meta: { side, mint, venue: quote.venue, usd: usdValue, signature, network, reason: 'mirror', leader: leaderRef, exec_route: execTelemetry?.route } });
	await cacheSet(`sol:bal:${address}:${network}`, null, 1).catch(() => {});

	return { status: 'executed', signature, custodyEventId: claimId, usd: usdValue, priceImpact: quote.priceImpactPct };
}

// ── public: mirror one leader trade onto one follow ───────────────────────────
// Idempotent via the agent_mirror_fills unique (follow_id, leader_event_id, side).
// Records exactly one fill row (executed / skipped / failed / unconfirmed) with a
// human-readable reason, and advances the follow cursor. Never throws.
export async function mirrorOne({ follow, leaderEvent, follower }) {
	const network = netOf(follow.network);
	// Claim the idempotency slot first so a concurrent fanout can't double-process.
	const [claimed] = await sql`
		INSERT INTO agent_mirror_fills
			(follow_id, follower_agent_id, leader_agent_id, owner_user_id, network,
			 leader_event_id, leader_signature, side, mint, leader_sol, status)
		VALUES (
			${follow.id}, ${follow.follower_agent_id}, ${follow.leader_agent_id}, ${follow.owner_user_id}, ${network},
			${leaderEvent.eventId}, ${leaderEvent.signature}, ${leaderEvent.side}, ${leaderEvent.mint},
			${leaderEvent.leaderSol}, 'pending'
		)
		ON CONFLICT (follow_id, leader_event_id, side) DO NOTHING
		RETURNING id
	`;
	if (!claimed) return { status: 'duplicate' };
	const fillId = Number(claimed.id);

	const finalize = async (patch) => {
		await sql`
			UPDATE agent_mirror_fills SET
				status = ${patch.status},
				skip_reason = ${patch.skip_reason ?? null},
				planned_sol = ${patch.planned_sol ?? null},
				custody_event_id = ${patch.custody_event_id ?? null},
				signature = ${patch.signature ?? null},
				usd = ${patch.usd ?? null},
				price_impact_pct = ${patch.price_impact_pct ?? null}
			WHERE id = ${fillId}
		`.catch(() => {});
		return { fillId, ...patch };
	};

	follower = follower || await loadFollower(follow.follower_agent_id);
	if (!follower) return finalize({ status: 'failed', skip_reason: 'follower_missing' });

	const conn = solanaConnection(network);
	let ownerPk = null;
	try { ownerPk = new PublicKey(follower.address); } catch { /* wallet not ready */ }
	const followerBalanceSol = ownerPk ? await readSol(conn, ownerPk, network) : null;

	// Per-follow daily spend already mirrored today (for the follow-level budget).
	let spentTodaySol = 0;
	if (follow.daily_budget_sol != null) {
		const [r] = await sql`
			SELECT COALESCE(SUM(planned_sol), 0)::float8 AS s FROM agent_mirror_fills
			WHERE follow_id = ${follow.id} AND side = 'buy' AND status = 'executed'
			  AND created_at > now() - interval '24 hours'
		`.catch(() => [{ s: 0 }]);
		spentTodaySol = Number(r?.s || 0);
	}

	const decision = planMirror({
		follow,
		leaderTrade: { side: leaderEvent.side, mint: leaderEvent.mint, leaderSol: leaderEvent.leaderSol },
		followerBalanceSol,
		spentTodaySol,
		killed: follower.killed,
	});

	if (decision.action === 'skip') {
		return finalize({ status: 'skipped', skip_reason: decision.reason });
	}

	const slippageBps = Math.max(0, Math.min(getTradeLimits(follower.meta).max_slippage_bps ?? DEFAULT_MIRROR_SLIPPAGE_BPS, DEFAULT_MIRROR_SLIPPAGE_BPS));
	const leaderRef = {
		leader_agent_id: follow.leader_agent_id,
		leader_name: follow.leader_name || null,
		leader_event_id: leaderEvent.eventId,
		leader_signature: leaderEvent.signature,
	};
	const idem = `mirror:${follow.id}:${leaderEvent.eventId}:${decision.side}`;

	if (decision.side === 'buy') {
		const result = await runFollowerTrade({
			follower, side: 'buy', mint: leaderEvent.mint, network,
			solAmount: decision.order_sol, tokenAmountRaw: null,
			slippageBps, idempotencyKey: idem, leaderRef,
		});
		return finalize({
			status: result.status === 'executed' ? 'executed' : result.status === 'unconfirmed' ? 'unconfirmed' : result.status === 'skipped' ? 'skipped' : 'failed',
			skip_reason: result.code || null,
			planned_sol: decision.order_sol,
			custody_event_id: result.custodyEventId || null,
			signature: result.signature || null,
			usd: result.usd ?? null,
			price_impact_pct: result.priceImpact ?? null,
		});
	}

	// SELL — mirror the exit: sell the follower's FULL balance of the mint.
	if (!ownerPk) return finalize({ status: 'skipped', skip_reason: 'wallet_preparing' });
	const mintPk = new PublicKey(leaderEvent.mint);
	const { raw } = await readTokenBalance(conn, ownerPk, mintPk);
	if (raw <= 0n) return finalize({ status: 'skipped', skip_reason: 'no_holding' });

	const result = await runFollowerTrade({
		follower, side: 'sell', mint: leaderEvent.mint, network,
		solAmount: null, tokenAmountRaw: raw.toString(),
		slippageBps, idempotencyKey: idem, leaderRef,
	});
	return finalize({
		status: result.status === 'executed' ? 'executed' : result.status === 'unconfirmed' ? 'unconfirmed' : result.status === 'skipped' ? 'skipped' : 'failed',
		skip_reason: result.code || null,
		custody_event_id: result.custodyEventId || null,
		signature: result.signature || null,
		usd: result.usd ?? null,
		price_impact_pct: result.priceImpact ?? null,
	});
}

// ── public: process every pending leader trade for one follow ─────────────────
// Used by both the cron fanout and the owner's "Sync now". Advances the cursor
// to the newest processed leader event so the next pass starts fresh.
export async function syncFollow(follow, { maxEvents = 25 } = {}) {
	const network = netOf(follow.network);
	const trades = await detectLeaderTrades(follow.leader_agent_id, network, Number(follow.last_leader_event_id || 0), maxEvents);
	if (!trades.length) return { processed: 0, results: [] };

	const follower = await loadFollower(follow.follower_agent_id);
	const results = [];
	let cursor = Number(follow.last_leader_event_id || 0);
	for (const ev of trades) {
		try {
			const r = await mirrorOne({ follow, leaderEvent: ev, follower });
			results.push({ eventId: ev.eventId, side: ev.side, ...r });
		} catch (e) {
			results.push({ eventId: ev.eventId, side: ev.side, status: 'failed', skip_reason: (e?.message || 'error').slice(0, 120) });
		}
		cursor = Math.max(cursor, ev.eventId);
	}
	if (cursor > Number(follow.last_leader_event_id || 0)) {
		await sql`UPDATE agent_mirror_follows SET last_leader_event_id = ${cursor}, updated_at = now() WHERE id = ${follow.id}`.catch(() => {});
	}
	return { processed: trades.length, results };
}
