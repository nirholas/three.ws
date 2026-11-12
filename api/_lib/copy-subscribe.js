/**
 * The one guarded path that attaches a copier to a leader.
 *
 * Both POST /api/copy/subscriptions (a single follow) and a syndicate join
 * (api/_lib/syndicates.js, one follow per syndicate leader) create copy
 * subscriptions through this function, so every follow on the platform clears
 * the same gates in the same order:
 *
 *   1. the leader is a public, live agent;
 *   2. SELF-COPY: a copier may not follow an agent they own;
 *   3. the COPYABLE BAR: a real closed on-chain record (api/_lib/copy-eligibility.js);
 *   4. the copier's sizing and guard rules are valid (api/_lib/copy-engine.js).
 *
 * Returns a result object instead of writing a response, so each endpoint keeps
 * its own response shape. Non-custodial: it stores the copier's wallet address
 * and rules, never a key.
 */

import { sql } from './db.js';
import { normalizeSubscriptionInput } from './copy-engine.js';
import { LEADER_ELIGIBILITY, evaluateLeaderEligibility, leaderCopyProfile } from './copy-eligibility.js';
import { isUuid } from './validate.js';

export const COPY_NETWORKS = new Set(['mainnet', 'devnet']);
export const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const fail = (status, code, message, extra = {}) => ({ ok: false, status, code, message, extra });

/**
 * Create or update the copier's subscription to one leader.
 *
 * @param {object} p
 * @param {string} p.userId    the copier.
 * @param {object} p.body      the raw request fields: leader_agent_id, copier_wallet, network, and the tunables.
 * @returns {Promise<{ok:true, subscription:object, leader:{id:string,name:string|null}, profile:object}
 *                  | {ok:false, status:number, code:string, message:string, extra:object}>}
 */
export async function subscribeCopier({ userId, body }) {
	const leaderId = String(body.leader_agent_id || '').trim();
	const wallet = String(body.copier_wallet || '').trim();
	const network = COPY_NETWORKS.has(body.network) ? body.network : 'mainnet';
	if (!isUuid(leaderId)) return fail(400, 'invalid_leader', 'leader_agent_id must be an agent UUID');
	if (!BASE58_RE.test(wallet)) return fail(400, 'invalid_wallet', 'copier_wallet must be a valid Solana address');

	const [leader] = await sql`
		select id, user_id, name, is_public from agent_identities
		where id = ${leaderId} and deleted_at is null limit 1
	`;
	if (!leader || leader.is_public === false) return fail(404, 'leader_not_found', 'No such public trader.');

	// Wash-trade guard: copying your own agent routes the performance fee back to
	// you while inflating that leader's copier count, copied volume, and the public
	// "earned X for being copied" figure. Refused outright: there is no legitimate
	// version of it, since the owner already controls the agent's own trading.
	if (leader.user_id === userId) {
		return fail(403, 'self_copy', 'You cannot copy an agent you own; you already control its trading.');
	}

	// Sybil bar: a leader needs a real, closed, on-chain track record before a
	// copier can attach money to it. The unmet criteria go back in the body so the
	// UI can say exactly what is missing instead of "not eligible".
	const profile = await leaderCopyProfile(leaderId, network);
	const eligibility = evaluateLeaderEligibility(profile);
	if (!eligibility.eligible) {
		return fail(
			409,
			'leader_not_copyable',
			`${leader.name || 'This trader'} does not have enough verified history to be copied yet: ${eligibility.unmet.map((u) => u.label).join(', ')}.`,
			{ eligibility: { ...eligibility, requirements: LEADER_ELIGIBILITY, network } },
		);
	}

	const norm = normalizeSubscriptionInput(body);
	if (!norm.ok) return fail(400, 'invalid_config', norm.error);
	const v = norm.value;
	const capProvided = v.spend_cap_sol != null;

	// Denormalize the leader's trading wallet from their most recent sniper position.
	const [pos] = await sql`
		select wallet from agent_sniper_positions
		where agent_id = ${leaderId} and network = ${network}
		order by opened_at desc limit 1
	`;
	const leaderWallet = pos?.wallet || null;

	const [row] = await sql`
		insert into copy_subscriptions (
			copier_user_id, copier_wallet, leader_agent_id, leader_wallet, network, status,
			sizing_rule, fixed_sol, multiplier, pct_balance,
			per_trade_cap_sol, min_order_sol, daily_budget_sol, max_open_copies,
			mcap_floor_usd, mcap_ceiling_usd, copy_sells, require_safety_pass, min_oracle_score, perf_fee_bps,
			max_drawdown_pct, telegram_chat_id, spend_cap_sol, spend_cap_set_at
		) values (
			${userId}, ${wallet}, ${leaderId}, ${leaderWallet}, ${network}, 'active',
			${v.sizing_rule}, ${v.fixed_sol}, ${v.multiplier}, ${v.pct_balance},
			${v.per_trade_cap_sol}, ${v.min_order_sol}, ${v.daily_budget_sol}, ${v.max_open_copies},
			${v.mcap_floor_usd}, ${v.mcap_ceiling_usd}, ${v.copy_sells}, ${v.require_safety_pass}, ${v.min_oracle_score}, ${v.perf_fee_bps},
			${v.max_drawdown_pct}, ${v.telegram_chat_id || null}, ${v.spend_cap_sol},
			${v.spend_cap_sol != null ? new Date() : null}
		)
		on conflict (copier_user_id, leader_agent_id, network) do update set
			copier_wallet = excluded.copier_wallet,
			leader_wallet = excluded.leader_wallet,
			status = 'active',
			sizing_rule = excluded.sizing_rule,
			fixed_sol = excluded.fixed_sol,
			multiplier = excluded.multiplier,
			pct_balance = excluded.pct_balance,
			per_trade_cap_sol = excluded.per_trade_cap_sol,
			min_order_sol = excluded.min_order_sol,
			daily_budget_sol = excluded.daily_budget_sol,
			max_open_copies = excluded.max_open_copies,
			mcap_floor_usd = excluded.mcap_floor_usd,
			mcap_ceiling_usd = excluded.mcap_ceiling_usd,
			copy_sells = excluded.copy_sells,
			require_safety_pass = excluded.require_safety_pass,
			min_oracle_score = excluded.min_oracle_score,
			perf_fee_bps = excluded.perf_fee_bps,
			max_drawdown_pct = excluded.max_drawdown_pct,
			telegram_chat_id = excluded.telegram_chat_id,
			-- A request that names a cap sets it and restarts its counter (a Follow
			-- tap). One that does not (the trader-page settings form) keeps the cap
			-- the follower already chose instead of silently lifting it.
			spend_cap_sol = case when ${capProvided}::boolean then excluded.spend_cap_sol else copy_subscriptions.spend_cap_sol end,
			spend_cap_set_at = case when ${capProvided}::boolean then excluded.spend_cap_set_at else copy_subscriptions.spend_cap_set_at end,
			-- Re-subscribing is a deliberate act, so it clears an auto-pause. A
			-- breaker that stayed latched here would silently re-arm a subscription
			-- the copier just reconfigured to a wider limit.
			paused_reason = null,
			paused_at = null,
			updated_at = now()
		returning *
	`;
	return { ok: true, subscription: row, leader: { id: leaderId, name: leader.name || null }, profile };
}
