/**
 * Agent portfolio history: the time series behind get_balance_history and
 * /api/v1/agents/:id/portfolio/history, and the P&L digest behind get_pnl.
 *
 * Two real sources, never interpolated:
 *
 *   1. agent_portfolio_snapshots: a full valuation (net worth in SOL and USD,
 *      realized and unrealized P&L) recorded whenever getPortfolio runs for an
 *      agent through the agent tools, the v1 route, or the hourly
 *      /api/cron/agent-portfolio-snapshots sweep. Throttled to one row per agent
 *      per network per SNAPSHOT_MIN_GAP_MS so a polling client cannot flood it.
 *   2. The realized trade ledger (agent_sniper_positions plus
 *      agent_strategy_positions via fetchTraderPositions): every closed trade
 *      carries its own closed_at and realized P&L, so the realized curve is
 *      exact back to the agent's first trade even before any snapshot existed.
 *
 * Pure helpers (realizedCurve, pnlDigest, bucketSnapshots) are exported for tests.
 */

import { sql } from './db.js';
import { getPortfolio } from './portfolio.js';
import { cachedSolUsd, fetchTraderPositions } from './trader-stats.js';

export const SNAPSHOT_MIN_GAP_MS = 15 * 60 * 1000;
const LAMPORTS_PER_SOL = 1e9;
const DAY_MS = 86_400_000;

const num = (v) => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const round = (n, dp = 6) => (n == null || !Number.isFinite(n) ? null : Number(n.toFixed(dp)));

/** A typed error the tool and route layers turn into a designed refusal. */
export class PortfolioAccessError extends Error {
	constructor(code, message, status) {
		super(message);
		this.code = code;
		this.status = status;
	}
}

/**
 * Load an agent and confirm the caller owns it. The portfolio exposes the
 * custody ledger, so every surface built on this module is owner-only.
 */
export async function loadPortfolioAgent(agentId, userId) {
	if (!/^[0-9a-f-]{36}$/i.test(String(agentId || ''))) throw new PortfolioAccessError('invalid_agent_id', 'agent_id must be a UUID.', 400);
	const [row] = await sql`select id, user_id, name, meta from agent_identities where id = ${agentId} and deleted_at is null limit 1`;
	if (!row) throw new PortfolioAccessError('not_found', 'No agent with that id.', 404);
	if (row.user_id !== userId) throw new PortfolioAccessError('forbidden', 'That agent belongs to another account.', 403);
	return row;
}

/**
 * Record one snapshot of a getPortfolio result, unless the agent already has
 * one on this network inside the throttle gap. Returns true when a row landed.
 */
export async function recordPortfolioSnapshot(portfolio, { source = 'read' } = {}) {
	if (!portfolio?.agent?.id || !portfolio.net_worth || portfolio.net_worth.sol == null) return false;
	const cutoff = new Date(Date.now() - SNAPSHOT_MIN_GAP_MS).toISOString();
	const nw = portfolio.net_worth;
	const rows = await sql`
		insert into agent_portfolio_snapshots
			(agent_id, network, net_worth_sol, net_worth_usd, sol_usd, realized_pnl_sol, unrealized_pnl_sol, holdings_count, source)
		select ${portfolio.agent.id}, ${portfolio.network}, ${nw.sol}, ${nw.usd ?? null}, ${portfolio.sol_usd ?? null},
		       ${nw.realized_pnl_sol ?? null}, ${nw.unrealized_pnl_sol ?? null}, ${(portfolio.holdings || []).length}, ${source}
		where not exists (
			select 1 from agent_portfolio_snapshots
			where agent_id = ${portfolio.agent.id} and network = ${portfolio.network} and captured_at > ${cutoff}
		)
		returning id
	`;
	return rows.length > 0;
}

/** Value an agent now and record the snapshot. Snapshot failure never fails the read. */
export async function portfolioWithSnapshot({ agentId, network, source = 'read' }) {
	const portfolio = await getPortfolio({ agentId, network });
	if (portfolio) {
		await recordPortfolioSnapshot(portfolio, { source }).catch((e) => {
			console.warn('[portfolio-history] snapshot write failed', e?.message);
		});
	}
	return portfolio;
}

/**
 * Cumulative realized P&L per UTC day from closed trades, oldest first. Days
 * without a close are omitted (the curve is flat across them). Only days at or
 * after sinceMs are returned, but the running total includes everything before,
 * so the first point is the true cumulative figure on that day.
 */
export function realizedCurve(positions, { sinceMs = 0, solUsd = null } = {}) {
	const closed = (positions || [])
		.filter((p) => p.status === 'closed' && p.closed_at && p.realized_pnl_lamports != null)
		.map((p) => ({ t: new Date(p.closed_at).getTime(), lamports: Number(p.realized_pnl_lamports) }))
		.filter((p) => Number.isFinite(p.t) && Number.isFinite(p.lamports))
		.sort((a, b) => a.t - b.t);
	const byDay = new Map();
	let running = 0;
	for (const p of closed) {
		running += p.lamports;
		const day = Math.floor(p.t / DAY_MS) * DAY_MS;
		const entry = byDay.get(day) || { trades: 0 };
		entry.trades += 1;
		entry.cumulative = running;
		byDay.set(day, entry);
	}
	const out = [];
	for (const [day, e] of byDay) {
		if (day + DAY_MS <= sinceMs) continue;
		const sol = e.cumulative / LAMPORTS_PER_SOL;
		out.push({
			date: new Date(day).toISOString().slice(0, 10),
			cumulative_realized_sol: round(sol),
			cumulative_realized_usd: solUsd != null ? round(sol * solUsd, 2) : null,
			trades_closed: e.trades,
		});
	}
	return out;
}

/**
 * Thin a snapshot series to at most maxPoints, keeping the first and last rows
 * exact, so a long history stays a sensible payload for a model.
 */
export function bucketSnapshots(rows, maxPoints = 120) {
	if (rows.length <= maxPoints) return rows;
	const out = [];
	const stride = (rows.length - 1) / (maxPoints - 1);
	for (let i = 0; i < maxPoints - 1; i++) out.push(rows[Math.round(i * stride)]);
	out.push(rows[rows.length - 1]);
	return out;
}

function summarizeSeries(points) {
	if (!points.length) return null;
	const first = points[0];
	const last = points[points.length - 1];
	let peak = -Infinity;
	let maxDd = 0;
	for (const p of points) {
		if (p.net_worth_sol > peak) peak = p.net_worth_sol;
		if (peak > 0) maxDd = Math.max(maxDd, (peak - p.net_worth_sol) / peak);
	}
	const changeSol = last.net_worth_sol - first.net_worth_sol;
	return {
		from: first.t,
		to: last.t,
		start_sol: first.net_worth_sol,
		end_sol: last.net_worth_sol,
		change_sol: round(changeSol),
		change_pct: first.net_worth_sol > 0 ? round((changeSol / first.net_worth_sol) * 100, 2) : null,
		start_usd: first.net_worth_usd,
		end_usd: last.net_worth_usd,
		change_usd: first.net_worth_usd != null && last.net_worth_usd != null ? round(last.net_worth_usd - first.net_worth_usd, 2) : null,
		peak_sol: round(peak),
		max_drawdown_pct: round(maxDd * 100, 2),
	};
}

/**
 * Net-worth history for one agent on one network over the last `days`, plus the
 * exact realized-P&L curve from the trade ledger.
 */
export async function getBalanceHistory({ agentId, network = 'mainnet', days = 30, maxPoints = 120, now = Date.now() }) {
	const net = network === 'devnet' ? 'devnet' : 'mainnet';
	const span = Math.min(Math.max(Math.trunc(Number(days) || 30), 1), 365);
	const since = new Date(now - span * DAY_MS).toISOString();
	const [rows, positions] = await Promise.all([
		sql`
			select captured_at, net_worth_sol, net_worth_usd, sol_usd, realized_pnl_sol, unrealized_pnl_sol, holdings_count, source
			from agent_portfolio_snapshots
			where agent_id = ${agentId} and network = ${net} and captured_at >= ${since}
			order by captured_at asc
			limit 5000
		`,
		fetchTraderPositions({ agentId, network: net, window: 'all', now }).catch(() => []),
	]);
	const points = bucketSnapshots(rows.map((r) => ({
		t: new Date(r.captured_at).toISOString(),
		net_worth_sol: num(r.net_worth_sol),
		net_worth_usd: num(r.net_worth_usd),
		sol_usd: num(r.sol_usd),
		realized_pnl_sol: num(r.realized_pnl_sol),
		unrealized_pnl_sol: num(r.unrealized_pnl_sol),
		holdings: r.holdings_count,
		source: r.source,
	})), Math.min(Math.max(Math.trunc(Number(maxPoints) || 120), 2), 500));
	const lastUsd = await cachedSolUsd();
	return {
		agent_id: agentId,
		network: net,
		days: span,
		snapshot_count: rows.length,
		points,
		summary: summarizeSeries(points),
		realized_curve: realizedCurve(positions, { sinceMs: now - span * DAY_MS, solUsd: lastUsd }),
		note: rows.length
			? 'Net-worth points are real valuations recorded at each timestamp; the realized curve is exact from closed trades.'
			: 'No valuations recorded in this window yet. One is recorded now on every portfolio read and hourly for active agents; the realized curve is exact from closed trades.',
	};
}

/**
 * The P&L view of a portfolio: totals, attribution by source, trading
 * performance, and the best and worst open positions. Pure over getPortfolio's
 * output.
 */
export function pnlDigest(portfolio) {
	const nw = portfolio.net_worth || {};
	const m = portfolio.metrics || {};
	const solUsd = portfolio.sol_usd;
	const usd = (sol) => (sol != null && solUsd != null ? round(sol * solUsd, 2) : null);
	const unrealized = nw.unrealized_pnl_sol ?? null;
	const realized = nw.realized_pnl_sol ?? null;
	const total = realized != null || unrealized != null ? round((realized || 0) + (unrealized || 0)) : null;
	const open = (portfolio.holdings || [])
		.filter((h) => h.unrealized_sol != null)
		.map((h) => ({
			mint: h.mint,
			symbol: h.symbol || null,
			name: h.name || null,
			cost_basis_sol: h.cost_basis_sol,
			unrealized_sol: h.unrealized_sol,
			unrealized_pct: h.unrealized_pct,
		}))
		.sort((a, b) => b.unrealized_sol - a.unrealized_sol);
	return {
		agent: portfolio.agent,
		network: portfolio.network,
		sol_usd: solUsd,
		t: portfolio.t,
		totals: {
			realized_sol: realized,
			realized_usd: nw.realized_pnl_usd ?? usd(realized),
			unrealized_sol: unrealized,
			unrealized_usd: usd(unrealized),
			total_sol: total,
			total_usd: usd(total),
			net_worth_sol: nw.sol ?? null,
			net_worth_usd: nw.usd ?? null,
		},
		by_source: portfolio.attribution || [],
		performance: {
			closed_trades: m.closed_count ?? 0,
			open_trades: m.open_count ?? 0,
			win_rate: m.win_rate ?? null,
			roi_pct: m.roi_pct ?? null,
			profit_factor: m.profit_factor ?? null,
			avg_win_pct: m.avg_win_pct ?? null,
			avg_loss_pct: m.avg_loss_pct ?? null,
			best_pnl_pct: m.best_pnl_pct ?? null,
			worst_pnl_pct: m.worst_pnl_pct ?? null,
			max_drawdown_pct: m.max_drawdown_pct ?? null,
			sharpe: m.sharpe ?? null,
		},
		top_winners: open.filter((h) => h.unrealized_sol > 0).slice(0, 5),
		top_losers: open.filter((h) => h.unrealized_sol < 0).slice(-5).reverse(),
		basis_note: portfolio.basis_note,
	};
}

/**
 * The agents worth a scheduled valuation: wallet-bearing agents that traded,
 * moved funds, or had a portfolio read in the last week, least recently
 * snapshotted first, so a capped sweep rotates through all of them.
 */
export async function agentsDueForSnapshot({ limit = 40 } = {}) {
	const since = new Date(Date.now() - 7 * DAY_MS).toISOString();
	return sql`
		with active as (
			select agent_id, network from agent_custody_events where created_at >= ${since}
			union
			select agent_id, network from agent_sniper_positions where coalesce(closed_at, opened_at) >= ${since}
			union
			select agent_id, network from agent_portfolio_snapshots where captured_at >= ${since} and source = 'read'
		)
		select a.agent_id, a.network, max(s.captured_at) as last_snapshot
		from active a
		join agent_identities i on i.id = a.agent_id and i.deleted_at is null and i.meta ? 'solana_address'
		left join agent_portfolio_snapshots s on s.agent_id = a.agent_id and s.network = a.network
		group by a.agent_id, a.network
		order by max(s.captured_at) asc nulls first
		limit ${limit}
	`;
}
