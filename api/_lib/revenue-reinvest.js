// Reinvest rules: the owner's standing instruction for what an agent's income
// does next ("20% to model credits, 20% into a DCA of the agent's own coin,
// 10% to a tools budget, keep the rest").
//
// Safety model, in the order it bites:
//   1. A rule only runs after the owner confirmed its exact hash (ruleHash).
//      Any edit clears the confirmation. The confirmation screen shows every
//      destination, the split and both caps (see rulePreview).
//   2. Each period runs once: the run row is unique on (rule, period), every
//      leg has its own idempotency key, and a leg that already executed is
//      never sent again.
//   3. Per-run and lifetime caps scale all legs by one factor (planRun).
//   4. Every leg goes through the same spend guards as any other agent spend.
//      A guard that wants the owner (step-up, burner cap) parks the leg in the
//      approvals inbox instead of failing; nothing moves until the owner says yes.
//   5. Repeated failures pause the rule and tell the owner.
//
// Legs:
//   model_credits  USDC from the agent wallet to the platform deposit wallet,
//                  then the owner's credit balance is credited from that signature.
//   tools_budget   the same on-chain deposit, then the credits are moved into the
//                  named x402 payment session's budget.
//   dca_own_coin   a pump.fun buy of the agent's own coin through the standard
//                  trade pipeline (kill switch, caps, firewall, ledger).
//   buyback_burn   the same buy, then exactly the tokens that buy delivered are
//                  burned from the agent wallet (read from the confirmed
//                  transaction, never from the quote). A burn that fails is
//                  retried by the settle pass; the buy is never repeated.
//   holder_rewards SOL from the agent wallet to the coin's top holders, split
//                  pro-rata or drawn by a weighted lottery whose seed (leg key +
//                  a finalized blockhash) is stored so anyone can re-run the draw.

import { sql } from './db.js';
import { insertNotification } from './notify.js';
import {
	RuleError, normalizeRule, ruleHash, lastPeriod, runKey, legKey, planRun, LEG_LABELS, usdToUsdcAtomics, formatAtomics,
} from './revenue-ledger-core.js';
import { cachedSolUsd } from './trader-stats.js';

export const FAILURES_BEFORE_PAUSE = 3;
const RULE_COLS = sql`id, user_id, agent_id, name, status, network, period, basis, legs, per_run_cap_usd, lifetime_cap_usd, min_run_usd,
	confirmed_hash, confirmed_at, paused_reason, consecutive_failures, active_from, created_at, updated_at`;

const num = (v) => (v == null ? null : Number(v));

function fail(status, code, message) {
	return Object.assign(new Error(message), { status, code });
}

export function ruleView(r) {
	const hash = ruleHash({ ...r, per_run_cap_usd: r.per_run_cap_usd, lifetime_cap_usd: r.lifetime_cap_usd });
	return {
		id: r.id, agent_id: r.agent_id, name: r.name, status: r.status, network: r.network, period: r.period, basis: r.basis,
		legs: r.legs, per_run_cap_usd: num(r.per_run_cap_usd), lifetime_cap_usd: num(r.lifetime_cap_usd), min_run_usd: num(r.min_run_usd),
		confirmed: Boolean(r.confirmed_hash) && r.confirmed_hash === hash,
		confirmed_at: r.confirmed_at, paused_reason: r.paused_reason, consecutive_failures: r.consecutive_failures,
		active_from: r.active_from, created_at: r.created_at, updated_at: r.updated_at,
		hash,
	};
}

async function ownedAgent(agentId, userId) {
	const [a] = await sql`select id, user_id, name, meta from agent_identities where id = ${agentId} and user_id = ${userId} and deleted_at is null`;
	if (!a) throw fail(404, 'not_found', 'Agent not found.');
	return a;
}

async function assertSession(sessionId, userId) {
	const [s] = await sql`select id, status, network from payment_sessions where id = ${sessionId} and user_id = ${userId}`;
	if (!s) throw new RuleError('That payment session does not exist or is not yours.');
	if (s.status !== 'active') throw new RuleError(`That payment session is ${s.status}. Pick an active one.`);
	return s;
}

export async function listRules({ userId, agentId = null }) {
	const rows = await sql`select ${RULE_COLS} from revenue_reinvest_rules where user_id = ${userId} ${agentId ? sql`and agent_id = ${agentId}` : sql``} order by created_at desc`;
	return rows.map(ruleView);
}

export async function getRule(ruleId, userId) {
	const [r] = await sql`select ${RULE_COLS} from revenue_reinvest_rules where id = ${ruleId} and user_id = ${userId}`;
	if (!r) throw fail(404, 'not_found', 'Rule not found.');
	return r;
}

export async function createRule({ userId, agentId, body }) {
	await ownedAgent(agentId, userId);
	const rule = normalizeRule(body);
	for (const l of rule.legs) if (l.kind === 'tools_budget') await assertSession(l.session_id, userId);
	const [row] = await sql`
		insert into revenue_reinvest_rules (user_id, agent_id, name, network, period, basis, legs, per_run_cap_usd, lifetime_cap_usd, min_run_usd)
		values (${userId}, ${agentId}, ${rule.name}, ${rule.network}, ${rule.period}, ${rule.basis}, ${JSON.stringify(rule.legs)}::jsonb,
			${rule.per_run_cap_usd}, ${rule.lifetime_cap_usd}, ${rule.min_run_usd})
		returning ${RULE_COLS}`;
	return ruleView(row);
}

/** Editing clears the confirmation and returns the rule to draft: the owner must confirm the new terms. */
export async function updateRule({ ruleId, userId, body }) {
	const cur = await getRule(ruleId, userId);
	const rule = normalizeRule({ ...cur, ...body, legs: body.legs ?? cur.legs });
	for (const l of rule.legs) if (l.kind === 'tools_budget') await assertSession(l.session_id, userId);
	const [row] = await sql`
		update revenue_reinvest_rules set name = ${rule.name}, network = ${rule.network}, period = ${rule.period}, basis = ${rule.basis},
			legs = ${JSON.stringify(rule.legs)}::jsonb, per_run_cap_usd = ${rule.per_run_cap_usd}, lifetime_cap_usd = ${rule.lifetime_cap_usd},
			min_run_usd = ${rule.min_run_usd}, confirmed_hash = null, confirmed_at = null, status = 'draft', active_from = null,
			paused_reason = null, consecutive_failures = 0, updated_at = now()
		where id = ${ruleId} and user_id = ${userId}
		returning ${RULE_COLS}`;
	return ruleView(row);
}

export async function deleteRule({ ruleId, userId }) {
	const gone = await sql`delete from revenue_reinvest_rules where id = ${ruleId} and user_id = ${userId} returning id`;
	if (!gone.length) throw fail(404, 'not_found', 'Rule not found.');
}

/**
 * The owner's explicit yes. `hash` must be the hash of the terms the owner was
 * shown; if the rule changed since, the confirm is refused and nothing activates.
 * Only periods that end after `active_from` are ever run, so confirming never
 * back-fills income earned before the owner said yes.
 */
export async function confirmRule({ ruleId, userId, hash }) {
	const cur = await getRule(ruleId, userId);
	const now = ruleView(cur);
	if (!hash || hash !== now.hash) throw fail(409, 'rule_changed', 'The rule changed since you reviewed it. Review the terms again and confirm.');
	const [row] = await sql`
		update revenue_reinvest_rules set confirmed_hash = ${now.hash}, confirmed_at = now(), status = 'active',
			active_from = coalesce(active_from, now()), paused_reason = null, consecutive_failures = 0, updated_at = now()
		where id = ${ruleId} and user_id = ${userId}
		returning ${RULE_COLS}`;
	return ruleView(row);
}

export async function pauseRule({ ruleId, userId, reason = 'Paused by you.' }) {
	await getRule(ruleId, userId);
	const [row] = await sql`
		update revenue_reinvest_rules set status = 'paused', paused_reason = ${reason}, updated_at = now()
		where id = ${ruleId} and user_id = ${userId} returning ${RULE_COLS}`;
	return ruleView(row);
}

// ── what a run would do ─────────────────────────────────────────────────────

async function baseIncome(rule, start, end) {
	const rows = await sql`
		select kind, coalesce(sum(usd), 0)::float8 as usd, count(*)::int as n
		from revenue_ledger_entries
		where agent_id = ${rule.agent_id} and user_id = ${rule.user_id} and counted and usd is not null
		  and network = ${rule.network} and occurred_at >= ${start} and occurred_at < ${end}
		group by kind`;
	const revenue = rows.find((r) => r.kind === 'revenue')?.usd || 0;
	const pnl = rows.find((r) => r.kind === 'pnl')?.usd || 0;
	const trading = rule.basis === 'revenue_and_trading_profit' ? Math.max(0, pnl) : 0;
	return { base: revenue + trading, breakdown: { revenue_usd: revenue, trading_pnl_usd: pnl, trading_profit_counted_usd: trading, entries: rows.reduce((a, r) => a + r.n, 0) } };
}

async function lifetimeSpent(ruleId) {
	const [r] = await sql`
		select coalesce(sum(l.capped_usd), 0)::float8 as usd
		from revenue_reinvest_legs l join revenue_reinvest_runs r on r.id = l.run_id
		where r.rule_id = ${ruleId} and r.mode = 'live' and l.status in ('executed', 'awaiting_approval')`;
	return r.usd;
}

async function ownCoinMint(agentId, network) {
	const [m] = await sql`select mint, symbol from pump_agent_mints where agent_id = ${agentId} and network = ${network} order by created_at desc limit 1`;
	return m || null;
}

/** The confirmation table: every destination, amount basis and cap, from live data. */
export async function rulePreview({ ruleId, userId, now = Date.now() }) {
	const cur = await getRule(ruleId, userId);
	const rule = ruleView(cur);
	const { start, end } = lastPeriod(rule.period, now);
	const { base, breakdown } = await baseIncome(cur, start, end);
	const spent = await lifetimeSpent(ruleId);
	const plan = planRun({ baseUsd: base, legs: rule.legs, perRunCapUsd: rule.per_run_cap_usd, lifetimeCapUsd: rule.lifetime_cap_usd, lifetimeSpentUsd: spent, minRunUsd: rule.min_run_usd });
	const deposit = (await import('./credit-deposit.js')).depositWallet();
	const coin = await ownCoinMint(cur.agent_id, cur.network);
	const table = rule.legs.map((l) => {
		const p = plan.legs.find((x) => x.kind === l.kind);
		const base = { kind: l.kind, label: LEG_LABELS[l.kind], pct: l.pct, chain: 'solana', network: rule.network, would_send_usd: p?.capped_usd ?? 0 };
		const noCoin = 'Agent has no coin on this network';
		if (l.kind === 'dca_own_coin') return { ...base, asset: 'SOL', recipient: coin?.mint || null, recipient_label: coin ? `${coin.symbol || 'own coin'} (pump.fun)` : noCoin, ready: Boolean(coin) };
		if (l.kind === 'buyback_burn') return { ...base, asset: 'SOL', recipient: coin?.mint || null, recipient_label: coin ? `Buy ${coin.symbol || 'own coin'}, then burn every token bought` : noCoin, ready: Boolean(coin) };
		if (l.kind === 'holder_rewards') {
			const how = l.mode === 'lottery' ? `${l.recipients} winners drawn by holding size` : `top ${l.recipients} holders, by holding size`;
			return { ...base, asset: 'SOL', recipient: null, recipient_label: coin ? `${coin.symbol || 'own coin'} holders: ${how}` : noCoin, ready: Boolean(coin) };
		}
		return { ...base, asset: 'USDC', recipient: deposit, recipient_label: l.kind === 'tools_budget' ? `Platform deposit wallet, then payment session ${String(l.session_id).slice(0, 8)}` : 'Platform deposit wallet, credited to your balance', ready: Boolean(deposit) };
	});
	return {
		rule, confirmation: table,
		period: { start: start.toISOString(), end: end.toISOString() },
		base_usd: base, base_breakdown: breakdown, lifetime_spent_usd: spent,
		plan: { executable_usd: plan.executable_usd, kept_usd: plan.kept_usd, scaled: plan.scaled, skip: plan.skip },
		note: rule.network === 'devnet' ? 'Devnet rule: no real funds move.' : 'Confirming authorises this rule to send the amounts above, from this agent wallet, to these destinations, every period, within both caps. Any edit asks you again.',
	};
}

// ── legs ────────────────────────────────────────────────────────────────────

async function getApproval(id) {
	const [a] = await sql`select id, status, signature, result from approval_requests where id = ${id}`;
	return a || null;
}

async function parkTransfer({ rule, run, leg, atomics, gateReason }) {
	const { createApprovalRequest } = await import('./approvals.js');
	const dest = (await import('./credit-deposit.js')).depositWallet();
	const usd = Number(leg.capped_usd);
	const created = await createApprovalRequest({
		userId: rule.user_id, agentId: rule.agent_id, source: 'revenue_reinvest', sourceRef: `leg:${leg.leg_key}`,
		actionType: 'reinvest_transfer', venue: 'revenue_reinvest',
		payload: { kind: 'reinvest_leg', leg_id: leg.id, leg_key: leg.leg_key, run_id: run.id, rule_id: rule.id, agent_id: rule.agent_id, network: rule.network, leg_kind: leg.kind, atomics: atomics.toString(), recipient: dest },
		summary: `Reinvest ${formatAtomics(atomics, 6)} USDC into ${LEG_LABELS[leg.kind].toLowerCase()} (rule "${rule.name}")`,
		amount: Number(formatAtomics(atomics, 6)), amountUsd: usd, asset: 'USDC', chain: 'solana', network: rule.network,
		recipient: dest, recipientLabel: 'Platform deposit wallet',
		riskNotes: ['This is an automatic reinvest from a rule you confirmed. It needs your yes this time because of your spend policy.'],
		gateReason, idempotencyKey: `reinvest-approval:${leg.leg_key}`, autoApprovable: false,
	});
	return created.request;
}

/** Move the deposited USDC into the owner's credit balance, and from there into a payment session budget. */
async function creditDeposit({ rule, leg, signature, usd, atomics }) {
	if (rule.network !== 'mainnet') return { credited: false, note: 'Devnet deposit: nothing is credited.' };
	const { creditAccount } = await import('./credits.js');
	await creditAccount({
		userId: rule.user_id, amountUsd: usd, kind: 'deposit', action: 'reinvest_deposit', refType: 'revenue_reinvest_leg', refId: leg.id,
		txSignature: signature, asset: 'USDC', assetAmount: formatAtomics(atomics, 6), priceUsd: 1, idempotencyKey: `${leg.idempotency_key}:credit`,
		meta: { rule_id: rule.id, leg: leg.kind },
	});
	if (leg.kind !== 'tools_budget') return { credited: true };
	const cfg = rule.legs.find((l) => l.kind === 'tools_budget');
	const topUp = await topUpPaymentSession({ userId: rule.user_id, sessionId: cfg.session_id, usd, atomics, idempotencyKey: `${leg.idempotency_key}:session` });
	return { credited: true, session_id: cfg.session_id, session_budget_usd: topUp.budgetUsd };
}

/**
 * Add `usd` to an active payment session's budget, paid from the owner's credits.
 * The debit is idempotent on the key, and the budget bump runs only when the
 * debit was new, so a retry can never top the session up twice.
 */
export async function topUpPaymentSession({ userId, sessionId, usd, atomics, idempotencyKey }) {
	const [s] = await sql`select id, status from payment_sessions where id = ${sessionId} and user_id = ${userId}`;
	if (!s || s.status !== 'active') throw fail(409, 'session_inactive', 'The tools budget session is not active, so credits were kept as a balance instead.');
	const { debitCredits } = await import('./credits.js');
	const debit = await debitCredits({ userId, amountUsd: usd, action: 'payment_session_topup', refType: 'payment_session', refId: sessionId, idempotencyKey });
	if (!debit.replay) {
		await sql`update payment_sessions set budget_usdc = budget_usdc + ${atomics.toString()}, updated_at = now() where id = ${sessionId} and user_id = ${userId}`;
	}
	const [after] = await sql`select budget_usdc from payment_sessions where id = ${sessionId}`;
	return { budgetUsd: Number(formatAtomics(BigInt(String(after.budget_usdc).split('.')[0]), 6)), replay: debit.replay };
}

async function setLeg(id, patch) {
	const [l] = await sql`
		update revenue_reinvest_legs set status = ${patch.status}, signature = ${patch.signature ?? null}, approval_id = ${patch.approval_id ?? null},
			destination = ${patch.destination ?? null}, asset = ${patch.asset ?? null}, amount_atomics = ${patch.amount_atomics ?? null},
			detail = detail || ${JSON.stringify(patch.detail || {})}::jsonb, error = ${patch.error ?? null},
			executed_at = ${patch.status === 'executed' ? sql`now()` : null}
		where id = ${id} returning *`;
	return l;
}

async function runTransferLeg({ rule, run, leg, stepUpApproved = false, approvalId = null }) {
	const { depositWallet } = await import('./credit-deposit.js');
	const dest = depositWallet();
	if (!dest) return setLeg(leg.id, { status: 'failed', error: 'No platform deposit wallet is configured, so nothing was sent.' });
	const cfg = rule.legs.find((l) => l.kind === leg.kind);
	if (leg.kind === 'tools_budget') {
		try { await assertSession(cfg.session_id, rule.user_id); } catch (e) { return setLeg(leg.id, { status: 'failed', error: `${e.message} Nothing was sent.` }); }
	}
	const usd = Number(leg.capped_usd);
	const atomics = usdToUsdcAtomics(usd);
	if (atomics <= 0n) return setLeg(leg.id, { status: 'skipped', detail: { reason: 'Amount rounds to zero.' } });
	const { agentTransfer } = await import('./agent-commerce/transfer.js');
	const { SpendLimitError } = await import('./agent-trade-guards.js');
	let sent;
	try {
		sent = await agentTransfer({
			agentId: rule.agent_id, userId: rule.user_id, network: rule.network, asset: 'USDC', recipient: dest, atomics,
			category: 'transfer', memo: 'reinvest', destinationTrust: 'system', stepUpApproved,
			rowMeta: { source: 'revenue_reinvest', rule_id: rule.id, run_id: run.id, leg: leg.kind, idempotency_key: leg.idempotency_key },
		});
	} catch (err) {
		if (err instanceof SpendLimitError && err.code === 'policy_step_up' && !stepUpApproved) {
			const req = await parkTransfer({ rule, run, leg, atomics, gateReason: err.message });
			return setLeg(leg.id, { status: 'awaiting_approval', approval_id: req.id, destination: dest, asset: 'USDC', amount_atomics: atomics.toString(), detail: { gate: err.message } });
		}
		return setLeg(leg.id, { status: 'failed', destination: dest, asset: 'USDC', amount_atomics: atomics.toString(), error: String(err?.message || err).slice(0, 300) });
	}
	let credit = {};
	try {
		credit = await creditDeposit({ rule, leg, signature: sent.signature, usd: sent.usd ?? usd, atomics });
	} catch (err) {
		// The USDC is already at the deposit wallet. Record that honestly; a later credit
		// attempt reuses the same idempotency key so it cannot double-credit.
		credit = { credit_error: String(err?.message || err).slice(0, 200) };
	}
	return setLeg(leg.id, {
		status: 'executed', signature: sent.signature, approval_id: approvalId, destination: dest, asset: 'USDC', amount_atomics: atomics.toString(),
		detail: { usd: sent.usd ?? usd, ...credit },
	});
}

async function runDcaLeg({ rule, run, leg, preview }) {
	const coin = await ownCoinMint(rule.agent_id, rule.network);
	if (!coin) return setLeg(leg.id, { status: 'failed', error: 'This agent has no coin on this network to buy. Nothing was sent.' });
	const solUsd = await cachedSolUsd().catch(() => null);
	if (!solUsd) return setLeg(leg.id, { status: 'failed', error: 'No live SOL price right now, so the buy size cannot be set. It will not retry this period.' });
	const sol = Math.floor((Number(leg.capped_usd) / solUsd) * 1e6) / 1e6;
	if (!(sol > 0)) return setLeg(leg.id, { status: 'skipped', detail: { reason: 'Amount rounds to zero.' } });
	const { executeAgentTrade, parseTradeInput } = await import('../agents/agent-trade.js');
	const { getTradeLimits } = await import('./agent-trade-guards.js');
	const [agent] = await sql`select id, user_id, meta from agent_identities where id = ${rule.agent_id} and deleted_at is null`;
	if (!agent) return setLeg(leg.id, { status: 'failed', error: 'The agent no longer exists.' });
	let input;
	try {
		input = parseTradeInput({ side: 'buy', mint: coin.mint, amount: sol, network: rule.network, simulate: preview, idempotency_key: leg.idempotency_key }, getTradeLimits(agent.meta));
	} catch (e) {
		return setLeg(leg.id, { status: 'failed', error: e?.message || 'The buy is not valid.' });
	}
	let r;
	try {
		r = await executeAgentTrade({ id: agent.id, userId: agent.user_id, meta: agent.meta || {}, input, source: 'discretionary' });
	} catch (e) {
		return setLeg(leg.id, { status: 'failed', destination: coin.mint, asset: 'SOL', error: String(e?.message || e).slice(0, 300) });
	}
	if (!r.ok) return setLeg(leg.id, { status: 'failed', destination: coin.mint, asset: 'SOL', error: `${r.message || r.code}`.slice(0, 300) });
	if (r.data?.pending_approval) {
		return setLeg(leg.id, { status: 'awaiting_approval', approval_id: r.data.approval_id, destination: coin.mint, asset: 'SOL', detail: { sol, gate: r.data.reason } });
	}
	if (r.data?.simulated) return setLeg(leg.id, { status: 'planned', destination: coin.mint, asset: 'SOL', detail: { simulated: true, sol, err: r.data.err } });
	return setLeg(leg.id, { status: 'executed', signature: r.data.signature, destination: coin.mint, asset: 'SOL', detail: { sol, usd: leg.capped_usd, symbol: coin.symbol } });
}

/**
 * Buy the agent's own coin, then burn what that buy delivered. A burn that
 * cannot run yet (the transaction is not readable, the RPC is down) leaves the
 * leg executed with the burn pending; settleBurns retries it. The buy itself
 * is never repeated.
 */
async function runBuybackBurnLeg({ rule, run, leg, preview }) {
	const bought = await runDcaLeg({ rule, run, leg, preview });
	if (preview || bought.status !== 'executed') return bought;
	return burnForLeg(rule, bought);
}

const MAX_BURN_ATTEMPTS = 5;

/**
 * Burn the tokens bought by an executed buyback leg, once. The claim is an
 * atomic update, so two settle passes never burn the same buy. A burn that
 * crashed mid-flight keeps its claim and is not retried blindly: a second
 * burn could destroy tokens the agent held before the buy.
 */
async function burnForLeg(rule, leg) {
	const [claimed] = await sql`
		update revenue_reinvest_legs
		set detail = detail || jsonb_build_object('burn_claimed_at', now(), 'burn_attempts', coalesce((detail->>'burn_attempts')::int, 0) + 1)
		where id = ${leg.id} and kind = 'buyback_burn' and status = 'executed' and signature is not null
		  and detail->>'burn_signature' is null and detail->>'burn_claimed_at' is null and detail->>'burn_skipped' is null
		  and coalesce((detail->>'burn_attempts')::int, 0) < ${MAX_BURN_ATTEMPTS}
		returning *`;
	if (!claimed) return leg;
	const { burnAgentTokens } = await import('./coin-control/chain.js');
	try {
		const b = await burnAgentTokens({ agentId: rule.agent_id, userId: rule.user_id, network: rule.network, mint: claimed.destination, buySignature: claimed.signature });
		const [done] = await sql`
			update revenue_reinvest_legs set detail = detail || ${JSON.stringify({
				burn_signature: b.signature, burned_raw: b.burned.toString(), bought_raw: b.bought?.toString() ?? null, decimals: b.decimals,
				burned_at: new Date().toISOString(), burn_error: null,
			})}::jsonb
			where id = ${leg.id} returning *`;
		return done;
	} catch (err) {
		const skip = err?.code === 'nothing_to_burn' || err?.code === 'buy_failed';
		const patch = { burn_error: String(err?.message || err).slice(0, 240), burn_claimed_at: null, ...(skip ? { burn_skipped: true } : {}) };
		const [done] = await sql`update revenue_reinvest_legs set detail = detail || ${JSON.stringify(patch)}::jsonb where id = ${leg.id} returning *`;
		return done;
	}
}

/** Retry every buyback whose buy executed but whose burn has not landed yet. */
export async function settleBurns() {
	const rows = await sql`
		select l.*, r.rule_id from revenue_reinvest_legs l join revenue_reinvest_runs r on r.id = l.run_id
		where l.kind = 'buyback_burn' and l.status = 'executed' and l.signature is not null and r.mode = 'live'
		  and l.detail->>'burn_signature' is null and l.detail->>'burn_claimed_at' is null and l.detail->>'burn_skipped' is null
		  and coalesce((l.detail->>'burn_attempts')::int, 0) < ${MAX_BURN_ATTEMPTS}
		  and l.executed_at > now() - interval '30 days'
		limit 25`;
	let burned = 0;
	for (const leg of rows) {
		const [rule] = await sql`select ${RULE_COLS} from revenue_reinvest_rules where id = ${leg.rule_id}`;
		if (!rule) continue;
		const done = await burnForLeg(rule, leg);
		if (done?.detail?.burn_signature) burned++;
	}
	return burned;
}

/** Wallets that must never receive a holder reward: the agent, the platform, and the creator's own. */
async function rewardExclusions(rule) {
	const [agent] = await sql`select meta->>'solana_address' as address from agent_identities where id = ${rule.agent_id}`;
	const own = await sql`select address from user_wallets where user_id = ${rule.user_id} and chain_type = 'solana'`;
	const deposit = (await import('./credit-deposit.js')).depositWallet();
	return [agent?.address, deposit, ...own.map((w) => w.address)].filter(Boolean);
}

/**
 * Who gets what this period. Pure on its inputs once the holder list and (for a
 * lottery) the blockhash are read, so the stored detail is a full receipt.
 */
async function planHolderRewards({ rule, leg }) {
	const coin = await ownCoinMint(rule.agent_id, rule.network);
	if (!coin) throw fail(409, 'no_coin', 'This agent has no coin on this network, so there are no holders to reward. Nothing was sent.');
	const solUsd = await cachedSolUsd().catch(() => null);
	if (!solUsd) throw fail(503, 'price_unavailable', 'No live SOL price right now, so the reward size cannot be set. Nothing was sent.');
	const cfg = rule.legs.find((l) => l.kind === 'holder_rewards') || {};
	const mode = cfg.mode === 'lottery' ? 'lottery' : 'pro_rata';
	const count = Number(cfg.recipients) || (mode === 'lottery' ? 3 : 10);
	const lamports = BigInt(Math.floor((Number(leg.capped_usd) / solUsd) * 1e9));
	const { fetchEligibleHolders, recentBlockhash } = await import('./coin-control/chain.js');
	const { splitProRata, drawLottery, lotterySeed, MIN_REWARD_LAMPORTS } = await import('./coin-control/core.js');
	const holders = await fetchEligibleHolders({ mint: coin.mint, network: rule.network, exclude: await rewardExclusions(rule) });
	let recipients;
	let lottery = null;
	if (mode === 'lottery') {
		const blockhash = await recentBlockhash(rule.network);
		const seed = lotterySeed(leg.leg_key, blockhash);
		recipients = drawLottery(holders, lamports, count, seed, MIN_REWARD_LAMPORTS);
		lottery = { seed, blockhash, leg_key: leg.leg_key, pool: holders.map((h) => ({ owner: h.owner, amount: h.amount })) };
	} else {
		recipients = splitProRata(holders, lamports, count, MIN_REWARD_LAMPORTS);
	}
	return {
		coin, mode, sol_usd: solUsd, pot_lamports: lamports.toString(), eligible: holders.length, lottery,
		recipients: recipients.map((r) => ({ owner: r.owner, amount: r.amount, lamports: r.lamports.toString() })),
	};
}

async function parkHolderRewards({ rule, run, leg, plan, gateReason }) {
	const { createApprovalRequest } = await import('./approvals.js');
	const { lamportsToSolString } = await import('./coin-control/core.js');
	const sol = lamportsToSolString(plan.pot_lamports);
	const created = await createApprovalRequest({
		userId: rule.user_id, agentId: rule.agent_id, source: 'revenue_reinvest', sourceRef: `leg:${leg.leg_key}`,
		actionType: 'reinvest_transfer', venue: 'revenue_reinvest',
		payload: { kind: 'reinvest_leg', leg_id: leg.id, leg_key: leg.leg_key, run_id: run.id, rule_id: rule.id, agent_id: rule.agent_id, network: rule.network, leg_kind: leg.kind, lamports: plan.pot_lamports, recipients: plan.recipients },
		summary: `Send ${sol} SOL to ${plan.recipients.length} ${plan.coin.symbol || 'coin'} holder${plan.recipients.length === 1 ? '' : 's'} (rule "${rule.name}")`,
		amount: Number(sol), amountUsd: Number(leg.capped_usd), asset: 'SOL', chain: 'solana', network: rule.network,
		recipient: plan.recipients[0]?.owner || null, recipientLabel: `${plan.recipients.length} holders, listed in the request`,
		riskNotes: ['This is an automatic holder reward from a rule you confirmed. It needs your yes this time because of your spend policy.'],
		gateReason, idempotencyKey: `reinvest-approval:${leg.leg_key}`, autoApprovable: false,
	});
	return created.request;
}

/**
 * Pay the period's holder rewards. On an approved retry the exact recipient
 * list the owner saw is reused, never redrawn.
 */
async function runHolderRewardsLeg({ rule, run, leg, preview, stepUpApproved = false, approvalId = null }) {
	let plan = stepUpApproved && leg.detail?.plan ? leg.detail.plan : null;
	if (!plan) {
		try {
			plan = await planHolderRewards({ rule, leg });
		} catch (err) {
			return setLeg(leg.id, { status: 'failed', asset: 'SOL', error: String(err?.message || err).slice(0, 300) });
		}
	}
	if (!plan.recipients.length) {
		const why = plan.eligible ? 'The pot is too small to give any holder the 0.001 SOL minimum.' : 'No holder wallets were eligible (program accounts and your own wallets are excluded).';
		return setLeg(leg.id, { status: 'skipped', destination: plan.coin.mint, asset: 'SOL', detail: { plan, reason: why } });
	}
	if (preview) return setLeg(leg.id, { status: 'planned', destination: plan.coin.mint, asset: 'SOL', amount_atomics: plan.pot_lamports, detail: { preview: true, plan } });

	const { airdropSol } = await import('./coin-control/chain.js');
	let res;
	try {
		res = await airdropSol({
			agentId: rule.agent_id, userId: rule.user_id, network: rule.network, stepUpApproved,
			recipients: plan.recipients.map((r) => ({ owner: r.owner, lamports: BigInt(r.lamports) })),
			memo: `three.ws holder reward ${plan.coin.symbol || ''}`.trim(),
			rowMeta: { source: 'revenue_reinvest', rule_id: rule.id, run_id: run.id, leg: leg.kind, idempotency_key: leg.idempotency_key, mint: plan.coin.mint },
		});
	} catch (err) {
		return setLeg(leg.id, { status: 'failed', destination: plan.coin.mint, asset: 'SOL', amount_atomics: plan.pot_lamports, detail: { plan }, error: String(err?.message || err).slice(0, 300) });
	}
	const gate = res.failed[0];
	if (!res.sent.length && gate?.code === 'policy_step_up' && !stepUpApproved) {
		const req = await parkHolderRewards({ rule, run, leg, plan, gateReason: gate.error });
		return setLeg(leg.id, { status: 'awaiting_approval', approval_id: req.id, destination: plan.coin.mint, asset: 'SOL', amount_atomics: plan.pot_lamports, detail: { plan, gate: gate.error } });
	}
	const sentLamports = res.sent.reduce((a, r) => a + BigInt(r.lamports), 0n).toString();
	const detail = { plan, sent: res.sent, failed: res.failed, sent_lamports: sentLamports, signatures: res.signatures };
	if (!res.sent.length) {
		return setLeg(leg.id, { status: 'failed', destination: plan.coin.mint, asset: 'SOL', amount_atomics: plan.pot_lamports, detail, error: gate?.error || 'No reward was sent.' });
	}
	return setLeg(leg.id, {
		status: 'executed', signature: res.signatures[0], approval_id: approvalId, destination: plan.coin.mint, asset: 'SOL', amount_atomics: sentLamports,
		detail, error: res.failed.length ? `${res.failed.length} of ${plan.recipients.length} rewards were not sent: ${gate.error}`.slice(0, 300) : null,
	});
}

// ── runs ────────────────────────────────────────────────────────────────────

async function pauseAfterFailures(rule, why) {
	await sql`update revenue_reinvest_rules set status = 'paused', paused_reason = ${why}, updated_at = now() where id = ${rule.id}`;
	insertNotification(rule.user_id, 'reinvest_rule_failed', {
		title: `Reinvest rule paused: ${rule.name}`,
		body: `${why} Nothing further runs until you review it.`,
		link: '/earnings#rules',
	});
}

/**
 * Run one rule for its last complete period. Safe to call repeatedly: a
 * period that already has a live run returns that run untouched.
 * `preview: true` plans and simulates (paper trades, no transfers) and writes nothing live.
 */
export async function runRule({ rule: cur, now = Date.now(), preview = false }) {
	const rule = { ...cur, legs: cur.legs };
	const view = ruleView(rule);
	if (!preview) {
		if (rule.status !== 'active') return { skipped: true, reason: `Rule is ${rule.status}.` };
		if (!view.confirmed) return { skipped: true, reason: 'The owner has not confirmed the current terms.' };
	}
	const { start, end } = lastPeriod(rule.period, now);
	if (!preview && rule.active_from && end <= new Date(rule.active_from)) return { skipped: true, reason: 'This period ended before the rule was confirmed.' };

	const key = preview ? `${runKey(rule.id, start)}:preview:${now}` : runKey(rule.id, start);
	const { base, breakdown } = await baseIncome(rule, start, end);
	const spent = await lifetimeSpent(rule.id);
	const plan = planRun({ baseUsd: base, legs: rule.legs, perRunCapUsd: num(rule.per_run_cap_usd), lifetimeCapUsd: num(rule.lifetime_cap_usd), lifetimeSpentUsd: spent, minRunUsd: num(rule.min_run_usd) });

	const inserted = await sql`
		insert into revenue_reinvest_runs (rule_id, user_id, agent_id, mode, period_start, period_end, idempotency_key, status, base_usd, base_breakdown, planned_usd, kept_usd, rule_snapshot, note)
		values (${rule.id}, ${rule.user_id}, ${rule.agent_id}, ${preview ? 'preview' : 'live'}, ${start}, ${end}, ${key}, 'running', ${base}, ${JSON.stringify(breakdown)}::jsonb,
			${plan.planned_usd}, ${plan.kept_usd}, ${JSON.stringify({ hash: view.hash, legs: rule.legs, per_run_cap_usd: num(rule.per_run_cap_usd), lifetime_cap_usd: num(rule.lifetime_cap_usd) })}::jsonb, ${plan.skip})
		on conflict do nothing returning *`;
	if (!inserted.length) {
		const [existing] = await sql`select * from revenue_reinvest_runs where idempotency_key = ${key} or (rule_id = ${rule.id} and period_start = ${start} and mode = 'live') limit 1`;
		return { skipped: true, reason: 'This period already ran.', run: existing };
	}
	const run = inserted[0];

	if (plan.skip) {
		await sql`update revenue_reinvest_runs set status = 'skipped', finished_at = now() where id = ${run.id}`;
		return { run: { ...run, status: 'skipped' }, plan, legs: [] };
	}

	const legRows = [];
	for (const p of plan.legs) {
		const [l] = await sql`
			insert into revenue_reinvest_legs (run_id, leg_key, kind, pct, planned_usd, capped_usd, idempotency_key, status)
			values (${run.id}, ${preview ? `${legKey(rule.id, start, p.kind)}:preview` : legKey(rule.id, start, p.kind)}, ${p.kind}, ${p.pct}, ${p.planned_usd}, ${p.capped_usd},
				${preview ? `${legKey(rule.id, start, p.kind)}:preview:${now}` : legKey(rule.id, start, p.kind)}, 'planned')
			on conflict (run_id, leg_key) do update set capped_usd = excluded.capped_usd returning *`;
		legRows.push(l);
	}

	const done = [];
	for (const leg of legRows) {
		if (Number(leg.capped_usd) <= 0) { done.push(await setLeg(leg.id, { status: 'skipped', detail: { reason: 'Nothing left after the caps.' } })); continue; }
		done.push(await runLeg({ rule, run, leg, preview }));
	}

	return finishRun({ rule, run, legs: done, preview });
}

function runLeg({ rule, run, leg, preview }) {
	switch (leg.kind) {
		case 'dca_own_coin': return runDcaLeg({ rule, run, leg, preview });
		case 'buyback_burn': return runBuybackBurnLeg({ rule, run, leg, preview });
		case 'holder_rewards': return runHolderRewardsLeg({ rule, run, leg, preview });
		default:
			return preview
				? setLeg(leg.id, { status: 'planned', asset: 'USDC', detail: { preview: true, would_send_usd: Number(leg.capped_usd) } })
				: runTransferLeg({ rule, run, leg });
	}
}

async function finishRun({ rule, run, legs, preview }) {
	const executed = legs.filter((l) => l.status === 'executed');
	const failed = legs.filter((l) => l.status === 'failed');
	const waiting = legs.filter((l) => l.status === 'awaiting_approval');
	const executedUsd = executed.reduce((a, l) => a + Number(l.capped_usd), 0);
	const status = preview ? 'completed' : failed.length && !executed.length && !waiting.length ? 'failed' : failed.length ? 'partial' : waiting.length ? 'awaiting_approval' : 'completed';
	const error = failed.map((l) => `${l.kind}: ${l.error}`).join(' | ') || null;
	const [row] = await sql`
		update revenue_reinvest_runs set status = ${status}, executed_usd = ${executedUsd}, error = ${error}, finished_at = now() where id = ${run.id} returning *`;
	if (!preview) {
		if (failed.length) {
			const [r] = await sql`update revenue_reinvest_rules set consecutive_failures = consecutive_failures + 1, updated_at = now() where id = ${rule.id} returning consecutive_failures`;
			insertNotification(rule.user_id, 'reinvest_rule_failed', {
				title: `Reinvest run had a failure: ${rule.name}`,
				body: `${error}`.slice(0, 280),
				link: '/earnings#rules',
			});
			if (r.consecutive_failures >= FAILURES_BEFORE_PAUSE) await pauseAfterFailures(rule, `${FAILURES_BEFORE_PAUSE} runs in a row had a failure.`);
		} else if (executed.length || waiting.length) {
			await sql`update revenue_reinvest_rules set consecutive_failures = 0 where id = ${rule.id}`;
			if (executed.length) {
				insertNotification(rule.user_id, 'reinvest_run', {
					title: `Reinvested $${executedUsd.toFixed(2)}: ${rule.name}`,
					body: executed.map((l) => `${LEG_LABELS[l.kind]} $${Number(l.capped_usd).toFixed(2)}`).join(', '),
					link: '/earnings#rules',
				});
			}
		}
	}
	return { run: row, legs };
}

/** Resolve legs that waited on the owner: record what the approval became. */
export async function settleApprovals() {
	const waiting = await sql`
		select l.id, l.kind, l.approval_id, l.run_id, a.status as a_status, a.signature as a_sig, r.rule_id, r.user_id
		from revenue_reinvest_legs l join revenue_reinvest_runs r on r.id = l.run_id join approval_requests a on a.id = l.approval_id
		where l.status = 'awaiting_approval' and a.status in ('executed', 'denied', 'expired', 'failed')`;
	let settled = 0;
	for (const w of waiting) {
		if (w.a_status === 'executed') {
			await sql`update revenue_reinvest_legs set status = 'executed', signature = coalesce(${w.a_sig}, signature), executed_at = now() where id = ${w.id}`;
		} else {
			await sql`update revenue_reinvest_legs set status = 'failed', error = ${`Approval ${w.a_status}; nothing was sent.`} where id = ${w.id}`;
		}
		const open = await sql`select 1 from revenue_reinvest_legs where run_id = ${w.run_id} and status = 'awaiting_approval' limit 1`;
		if (!open.length) {
			const legs = await sql`select status, capped_usd from revenue_reinvest_legs where run_id = ${w.run_id}`;
			const ex = legs.filter((l) => l.status === 'executed');
			const bad = legs.filter((l) => l.status === 'failed');
			await sql`update revenue_reinvest_runs set status = ${bad.length ? (ex.length ? 'partial' : 'failed') : 'completed'},
				executed_usd = ${ex.reduce((a, l) => a + Number(l.capped_usd), 0)}, finished_at = now() where id = ${w.run_id}`;
		}
		settled++;
	}
	return settled;
}

/** Cron entry: settle approvals, then run every active, confirmed rule for its last period. */
export async function runDueRules({ now = Date.now() } = {}) {
	const settled = await settleApprovals().catch(() => 0);
	const burned = await settleBurns().catch((err) => { console.error('[revenue-reinvest] burn settle failed', err?.message); return 0; });
	const rules = await sql`select ${RULE_COLS} from revenue_reinvest_rules where status = 'active' and confirmed_hash is not null`;
	const out = { settled, burned, rules: rules.length, ran: 0, skipped: 0, failed: 0 };
	for (const r of rules) {
		try {
			const res = await runRule({ rule: r, now });
			if (res.skipped) out.skipped++;
			else out.ran++;
		} catch (err) {
			out.failed++;
			console.error('[revenue-reinvest] rule failed', r.id, err?.message);
		}
	}
	return out;
}

/**
 * Executor for approved reinvest transfers (registered in approvals.js).
 * Runs ONLY the stored leg, for the rule's agent, if the approving account still owns it.
 */
export async function executeApprovedReinvestLeg(row) {
	const p = row.payload || {};
	if (p.kind !== 'reinvest_leg') return { status: 'error', note: 'Unknown reinvest action, so nothing was executed.' };
	const [leg] = await sql`select * from revenue_reinvest_legs where id = ${p.leg_id}`;
	const [run] = leg ? await sql`select * from revenue_reinvest_runs where id = ${leg.run_id}` : [];
	const [rule] = run ? await sql`select ${RULE_COLS} from revenue_reinvest_rules where id = ${run.rule_id}` : [];
	if (!leg || !rule) return { status: 'error', note: 'The rule behind this request was deleted, so nothing was executed.' };
	if (String(rule.user_id) !== String(row.user_id)) return { status: 'error', note: 'This rule is no longer owned by the account that approved it, so nothing was executed.' };
	if (leg.status === 'executed') return { status: 'ok', signature: leg.signature, usd: Number(leg.capped_usd) };
	const done = leg.kind === 'holder_rewards'
		? await runHolderRewardsLeg({ rule, run, leg, preview: false, stepUpApproved: true, approvalId: row.id })
		: await runTransferLeg({ rule, run, leg, stepUpApproved: true, approvalId: row.id });
	if (done.status !== 'executed') return { status: 'error', note: done.error || 'The reinvest transfer did not go through.' };
	return { status: 'ok', signature: done.signature, usd: Number(done.capped_usd) };
}

export async function listRuns({ userId, ruleId = null, agentId = null, limit = 30 }) {
	const runs = await sql`
		select * from revenue_reinvest_runs where user_id = ${userId} ${ruleId ? sql`and rule_id = ${ruleId}` : sql``} ${agentId ? sql`and agent_id = ${agentId}` : sql``}
		order by started_at desc limit ${Math.min(Number(limit) || 30, 100)}`;
	if (!runs.length) return [];
	const ids = runs.map((r) => r.id);
	const legs = await sql`select * from revenue_reinvest_legs where run_id = any(${ids}::uuid[]) order by created_at`;
	return runs.map((r) => ({ ...r, legs: legs.filter((l) => l.run_id === r.id) }));
}
