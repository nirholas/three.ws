/**
 * Agent sniper control for callers that are not the dashboard form: the
 * threews-agent MCP tools sniper_status, sniper_activate_preview,
 * sniper_activate and sniper_deactivate.
 *
 * It writes the same agent_sniper_strategies row as POST /api/sniper/strategy
 * and the agent-sniper worker reads it the same way, so a strategy armed here
 * is indistinguishable from one armed on /sniper. The guards are the same too:
 * a mandatory stop loss, a positive per-trade size and daily budget, a per-trade
 * size no larger than the budget, and the signed real-funds agreement before a
 * mainnet strategy is armed (enforced by the caller, which owns the session).
 *
 * Arming never moves funds by itself: the worker spends from the agent's own
 * wallet only when a launch passes the strategy's filters, inside the daily
 * budget. Treasury auto-funding stays operator-granted and is never touched.
 */

import { sql } from './db.js';
import { solanaConnection } from './solana/connection.js';
import { deriveSniperState } from './sniper-solvency.js';

const LAMPORTS_PER_SOL = 1_000_000_000n;
const HEARTBEAT_FRESH_MS = 90_000;
export const SNIPER_TRIGGERS = ['new_mint', 'first_claim', 'intel_confirmed', 'prelaunch_radar', 'alpha_hunt', 'graduation_ride'];

const TRIGGER_LABELS = {
	new_mint: 'every new pump.fun launch that passes the filters',
	first_claim: "a creator's coin the first time they ever claim rewards",
	intel_confirmed: 'launches confirmed by the coin-intel scorer',
	prelaunch_radar: 'launches by creators on the pre-launch radar',
	alpha_hunt: 'launches with smart-money and narrative signals',
	graduation_ride: 'AMM pools at graduation, sold into the buyback window',
};

/** A designed refusal the tool layer turns into an isError result. */
export class SniperControlError extends Error {
	constructor(code, message) {
		super(message);
		this.code = code;
	}
}

/** SOL (number) to an exact lamport string, refusing anything below one lamport. */
export function solToLamports(sol) {
	const n = Number(sol);
	if (!Number.isFinite(n) || n <= 0) return null;
	const [whole, frac = ''] = n.toFixed(9).split('.');
	const lamports = BigInt(whole) * LAMPORTS_PER_SOL + BigInt(frac.padEnd(9, '0').slice(0, 9));
	return lamports > 0n ? lamports.toString() : null;
}

export const lamportsToSol = (l) => (l == null ? null : Number(BigInt(String(l))) / 1e9);

async function ownedAgent(agentId, userId) {
	const [row] = await sql`
		select id, name, meta->>'solana_address' as wallet
		from agent_identities
		where id = ${agentId} and user_id = ${userId} and deleted_at is null
		limit 1
	`;
	if (!row) throw new SniperControlError('not_found', 'No agent with that id on your account.');
	return row;
}

async function walletSol(address, network) {
	if (!address) return null;
	try {
		const conn = solanaConnection({ network: network === 'devnet' ? 'devnet' : 'mainnet' });
		const { PublicKey } = await import('@solana/web3.js');
		return (await conn.getBalance(new PublicKey(address))) / 1e9;
	} catch {
		return null;
	}
}

/** The agent-sniper worker's live state, the same derivation as /api/sniper/status. */
export async function sniperWorkerState() {
	const [beat] = await sql`select mode, last_beat_at, meta from bot_heartbeat where worker = 'agent-sniper' limit 1`;
	if (!beat) return { state: 'unknown', reason: 'no heartbeat reported yet', network: null, mode: null };
	const ageMs = beat.last_beat_at ? Date.now() - new Date(beat.last_beat_at).getTime() : null;
	const alive = ageMs != null && ageMs < HEARTBEAT_FRESH_MS;
	const meta = beat.meta && typeof beat.meta === 'object' ? beat.meta : {};
	const feedLive = alive && meta.feedConnected === true;
	const feedSilent = alive && Number(meta.lastEventAgeMs) > (Number(meta.feedWatchdogMs) || 180_000);
	const solvency = meta.solvency && typeof meta.solvency === 'object' ? meta.solvency : null;
	return {
		state: deriveSniperState({ alive, feedLive, feedSilent: !!feedSilent, solvencyState: solvency?.state || 'unknown' }),
		mode: beat.mode || meta.mode || null,
		network: meta.network || 'mainnet',
		heartbeat_age_ms: ageMs,
		feed_live: feedLive,
		global_kill: meta.globalKill ?? null,
	};
}

function strategyView(s, stats, spentToday) {
	const perTrade = String(s.per_trade_lamports);
	const daily = String(s.daily_budget_lamports);
	return {
		agent_id: s.agent_id,
		agent_name: s.agent_name,
		wallet: s.wallet || null,
		network: s.network,
		armed: s.enabled === true && s.kill_switch !== true,
		enabled: s.enabled,
		kill_switch: s.kill_switch,
		trigger: s.trigger || 'new_mint',
		trigger_description: TRIGGER_LABELS[s.trigger || 'new_mint'] || s.trigger,
		per_trade_sol: lamportsToSol(perTrade),
		daily_budget_sol: lamportsToSol(daily),
		spent_today_sol: lamportsToSol(spentToday || '0'),
		max_concurrent_positions: s.max_concurrent_positions,
		stop_loss_pct: Number(s.stop_loss_pct),
		take_profit_pct: s.take_profit_pct != null ? Number(s.take_profit_pct) : null,
		trailing_stop_pct: s.trailing_stop_pct != null ? Number(s.trailing_stop_pct) : null,
		max_hold_seconds: s.max_hold_seconds,
		filters: {
			min_market_cap_usd: s.min_market_cap_usd != null ? Number(s.min_market_cap_usd) : null,
			max_market_cap_usd: s.max_market_cap_usd != null ? Number(s.max_market_cap_usd) : null,
			min_creator_graduated: s.min_creator_graduated,
			max_creator_launches: s.max_creator_launches,
			require_socials: s.require_socials,
			min_quality_score: s.min_quality_score != null ? Number(s.min_quality_score) : null,
		},
		positions: {
			open: Number(stats?.open_positions || 0),
			closed: Number(stats?.closed_positions || 0),
			wins: Number(stats?.wins || 0),
			realized_pnl_sol: lamportsToSol(stats?.realized_pnl_lamports || '0'),
		},
		updated_at: s.updated_at,
	};
}

/**
 * Every sniper strategy the caller owns (optionally one agent or network), with
 * today's committed spend, the position ledger summary, and the worker state.
 */
export async function sniperStatus({ userId, agentId = null, network = null }) {
	const rows = await sql`
		select s.*, a.name as agent_name, a.meta->>'solana_address' as wallet
		from agent_sniper_strategies s
		join agent_identities a on a.id = s.agent_id and a.deleted_at is null
		where s.user_id = ${userId}
		  and (${agentId}::uuid is null or s.agent_id = ${agentId}::uuid)
		  and (${network}::text is null or s.network = ${network}::text)
		order by s.updated_at desc
		limit 50
	`;
	const ids = rows.map((r) => r.agent_id);
	const [stats, spend, worker] = await Promise.all([
		ids.length
			? sql`
				select agent_id, network,
				       count(*) filter (where status in ('opening','open','closing')) as open_positions,
				       count(*) filter (where status = 'closed') as closed_positions,
				       count(*) filter (where status = 'closed' and realized_pnl_lamports > 0) as wins,
				       coalesce(sum(realized_pnl_lamports) filter (where status = 'closed'), 0)::text as realized_pnl_lamports
				from agent_sniper_positions
				where agent_id = any(${ids}::uuid[])
				group by agent_id, network
			`
			: [],
		ids.length
			? sql`
				select agent_id, network, coalesce(sum(coalesce(stake_lamports, entry_quote_lamports)), 0)::text as spent
				from agent_sniper_positions
				where agent_id = any(${ids}::uuid[]) and opened_at >= date_trunc('day', now()) and status <> 'failed'
				group by agent_id, network
			`
			: [],
		sniperWorkerState().catch(() => ({ state: 'unknown', reason: 'status store unreachable' })),
	]);
	const key = (r) => `${r.agent_id}:${r.network}`;
	const statsBy = new Map(stats.map((r) => [key(r), r]));
	const spendBy = new Map(spend.map((r) => [key(r), r.spent]));
	const strategies = rows.map((s) => strategyView(s, statsBy.get(key(s)), spendBy.get(key(s))));
	return { worker, strategies, armed_count: strategies.filter((s) => s.armed).length };
}

function readSizing(input) {
	const perTrade = solToLamports(input.per_trade_sol);
	const daily = solToLamports(input.daily_budget_sol);
	if (!perTrade) throw new SniperControlError('invalid_size', 'per_trade_sol must be a positive SOL amount.');
	if (!daily) throw new SniperControlError('invalid_budget', 'daily_budget_sol must be a positive SOL amount.');
	if (BigInt(perTrade) > BigInt(daily)) throw new SniperControlError('invalid_size', 'per_trade_sol cannot exceed daily_budget_sol.');
	const stopLoss = input.stop_loss_pct == null ? null : Number(input.stop_loss_pct);
	if (stopLoss != null && !(stopLoss > 0 && stopLoss <= 95)) throw new SniperControlError('invalid_stop_loss', 'stop_loss_pct must be between 0 and 95.');
	return { perTrade, daily, stopLoss };
}

/**
 * Describe exactly what arming would do, without writing anything: the agent,
 * its wallet and live balance, the sizing, the trigger and exits, and every
 * reason it would be refused. The MCP policy stamps a preview_id on this.
 */
export async function previewActivation({ userId, agentId, network = 'mainnet', input }) {
	const agent = await ownedAgent(agentId, userId);
	const { perTrade, daily, stopLoss } = readSizing(input);
	const [existing] = await sql`select * from agent_sniper_strategies where agent_id = ${agentId} and network = ${network} limit 1`;
	const [balance, worker] = await Promise.all([
		walletSol(agent.wallet, network),
		sniperWorkerState().catch(() => ({ state: 'unknown', network: null })),
	]);
	const trigger = input.trigger || existing?.trigger || 'new_mint';
	const perTradeSol = lamportsToSol(perTrade);
	const checks = [
		{ id: 'wallet', ok: !!agent.wallet, label: agent.wallet ? `Agent wallet ${agent.wallet}` : 'The agent has no Solana wallet yet (provision_wallet creates one)' },
		{ id: 'balance', ok: balance == null || balance >= perTradeSol, label: balance == null ? 'Wallet balance could not be read right now' : `Wallet holds ${balance.toFixed(4)} SOL against a ${perTradeSol} SOL entry` },
		{ id: 'worker', ok: worker.network == null || worker.network === network, label: worker.network && worker.network !== network ? `The sniper worker currently trades ${worker.network}, so a ${network} strategy is stored but idle` : `Sniper worker ${worker.state}` },
	];
	const blocked = checks.filter((c) => !c.ok && c.id === 'wallet').map((c) => c.id);
	return {
		agent: { id: agent.id, name: agent.name, wallet: agent.wallet },
		network,
		chain: 'Solana',
		asset: 'SOL',
		recipient: 'pump.fun bonding curves and AMM pools of the launches the strategy buys; proceeds return to the agent wallet',
		per_trade_sol: perTradeSol,
		daily_budget_sol: lamportsToSol(daily),
		per_trade_lamports: perTrade,
		daily_budget_lamports: daily,
		max_concurrent_positions: input.max_concurrent_positions ?? existing?.max_concurrent_positions ?? 1,
		trigger,
		trigger_description: TRIGGER_LABELS[trigger] || trigger,
		stop_loss_pct: stopLoss ?? (existing ? Number(existing.stop_loss_pct) : 30),
		take_profit_pct: input.take_profit_pct ?? (existing?.take_profit_pct != null ? Number(existing.take_profit_pct) : null),
		wallet_sol: balance,
		previously: existing ? { enabled: existing.enabled, kill_switch: existing.kill_switch } : null,
		worker,
		checks,
		executable: blocked.length === 0,
		blocked_by: blocked,
		real_funds: network === 'mainnet',
	};
}

/**
 * Arm the strategy: insert or update the row with the previewed sizing and set
 * enabled, clearing the kill switch. Every other knob keeps its stored value
 * (or the column default for a new row), so the dashboard's finer settings are
 * never clobbered.
 */
export async function activateSniper({ userId, agentId, network = 'mainnet', input }) {
	const agent = await ownedAgent(agentId, userId);
	if (!agent.wallet) throw new SniperControlError('no_wallet', 'The agent has no Solana wallet yet. Provision one before arming the sniper.');
	const { perTrade, daily, stopLoss } = readSizing(input);
	const trigger = input.trigger || null;
	if (trigger && !SNIPER_TRIGGERS.includes(trigger)) throw new SniperControlError('invalid_trigger', `trigger must be one of ${SNIPER_TRIGGERS.join(', ')}.`);
	const maxConcurrent = input.max_concurrent_positions != null ? Math.min(50, Math.max(1, Math.trunc(input.max_concurrent_positions))) : null;
	const takeProfit = input.take_profit_pct != null ? Number(input.take_profit_pct) : null;
	const [row] = await sql`
		insert into agent_sniper_strategies
			(agent_id, user_id, network, enabled, kill_switch, trigger, per_trade_lamports, daily_budget_lamports,
			 stop_loss_pct, max_concurrent_positions, take_profit_pct, updated_at)
		values
			(${agentId}, ${userId}, ${network}, true, false, coalesce(${trigger}::text, 'new_mint'), ${perTrade}, ${daily},
			 coalesce(${stopLoss}::numeric, 30), coalesce(${maxConcurrent}::int, 1), ${takeProfit}, now())
		on conflict (agent_id, network) do update set
			enabled = true,
			kill_switch = false,
			trigger = coalesce(${trigger}::text, agent_sniper_strategies.trigger),
			per_trade_lamports = excluded.per_trade_lamports,
			daily_budget_lamports = excluded.daily_budget_lamports,
			stop_loss_pct = coalesce(${stopLoss}::numeric, agent_sniper_strategies.stop_loss_pct),
			max_concurrent_positions = coalesce(${maxConcurrent}::int, agent_sniper_strategies.max_concurrent_positions),
			take_profit_pct = coalesce(${takeProfit}::numeric, agent_sniper_strategies.take_profit_pct),
			updated_at = now()
		returning *
	`;
	return strategyView({ ...row, agent_name: agent.name, wallet: agent.wallet }, null, null);
}

/**
 * Disarm: enabled=false, or with kill the kill switch as well (the worker also
 * stops managing exits for a killed strategy's new entries). Idempotent; a
 * strategy that does not exist is reported, not created.
 */
export async function deactivateSniper({ userId, agentId, network = 'mainnet', kill = false }) {
	const agent = await ownedAgent(agentId, userId);
	const [row] = await sql`
		update agent_sniper_strategies
		set enabled = false,
		    kill_switch = case when ${kill} then true else kill_switch end,
		    updated_at = now()
		where agent_id = ${agentId} and network = ${network} and user_id = ${userId}
		returning *
	`;
	if (!row) return { agent_id: agentId, network, existed: false, armed: false };
	const [open] = await sql`
		select count(*)::int as n from agent_sniper_positions
		where agent_id = ${agentId} and network = ${network} and status in ('opening','open','closing')
	`;
	return { ...strategyView({ ...row, agent_name: agent.name, wallet: agent.wallet }, { open_positions: open?.n }, null), existed: true };
}
