// threews-agent MCP: an agent's valued portfolio, its net-worth history, and
// its P&L.
//
// Thin adapters over api/_lib/portfolio.js (live valuation, FIFO cost basis,
// attribution, risk) and api/_lib/portfolio-history.js (snapshots and the
// realized curve), the same modules behind the wallet hub's Portfolio tab and
// /api/v1/agents/:id/portfolio. Every tool is owner-only, because attribution
// reads the agent's custody ledger, and none of them moves funds.
//
//   read  get_portfolio, get_balance_history, get_pnl

import { hasScope } from '../_lib/auth.js';
import { limits } from '../_lib/rate-limit.js';
import {
	PortfolioAccessError, loadPortfolioAgent, portfolioWithSnapshot, getBalanceHistory, pnlDigest,
} from '../_lib/portfolio-history.js';

// Live chain reads: the answer moves with prices, so not idempotent.
const LIVE_READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true };
// Recorded history: the same arguments return the same stored series.
const HISTORY_READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const sol = (n) => (n == null ? 'n/a' : `${Number(n).toFixed(4)} SOL`);
const usd = (n) => (n == null ? 'n/a' : `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
const pct = (n) => (n == null ? 'n/a' : `${Number(n).toFixed(2)}%`);

function refusal(text, reason, extra = {}) {
	return { content: [{ type: 'text', text }], structuredContent: { ok: false, reason, ...extra }, isError: true };
}

async function enforce(auth) {
	const rl = await limits.mcpAgent(auth.userId || auth.rateKey || 'anon');
	if (!rl.success) {
		throw Object.assign(new Error('rate_limited'), { code: -32000, data: { retry_after: Math.ceil((rl.reset - Date.now()) / 1000) } });
	}
}

async function run(auth, agentId, fn) {
	await enforce(auth);
	if (!auth.userId) return refusal('Sign in to three.ws to read your agents.', 'auth_required', { signed_in: false });
	if (!hasScope(auth.scope, 'wallet:read') && !hasScope(auth.scope, 'wallet:write')) {
		return refusal('Reading a portfolio needs the wallet:read scope. Re-authorize with it granted.', 'insufficient_scope', { required: 'wallet:read' });
	}
	try {
		await loadPortfolioAgent(agentId, auth.userId);
		return await fn();
	} catch (err) {
		if (err instanceof PortfolioAccessError) return refusal(err.message, err.code);
		throw err;
	}
}

const agentIdProp = { type: 'string', format: 'uuid', description: 'The agent whose wallet to read. wallet_status or three://agents lists yours.' };
const networkProp = { type: 'string', enum: ['mainnet', 'devnet'], default: 'mainnet', description: 'Solana cluster.' };

function holdingLine(h) {
	const label = h.isNative ? 'SOL' : (h.symbol || (h.mint ? `${h.mint.slice(0, 4)}...${h.mint.slice(-4)}` : 'token'));
	const basis = h.cost_basis_sol != null ? `, cost ${sol(h.cost_basis_sol)}, unrealized ${sol(h.unrealized_sol)} (${pct(h.unrealized_pct)})` : '';
	const flag = h.liquidity_warning ? ` [${h.liquidity_warning}]` : '';
	return `- ${label}: ${h.amount ?? 'n/a'} worth ${usd(h.usd_value)}${basis}${flag}`;
}

export const portfolioToolDefs = [
	{
		name: 'get_portfolio',
		title: "Value an agent's portfolio",
		group: 'wallet',
		tier: 'read',
		annotations: LIVE_READ,
		description: "Live valuation of one of your agents' Solana wallet: SOL and every SPL holding in SOL and USD, FIFO cost basis and unrealized P&L per holding, realized and unrealized P&L by source (sniper, discretionary trades, strategies, x402 spend, withdrawals), risk metrics and plain-language risk flags. Records a net-worth point for get_balance_history. Use this when the user asks what an agent holds, what it is worth, or how risky its wallet is.",
		inputSchema: {
			type: 'object',
			properties: { agent_id: agentIdProp, network: networkProp, max_holdings: { type: 'integer', minimum: 1, maximum: 100, default: 25 } },
			required: ['agent_id'],
			additionalProperties: false,
		},
		handler: (args, auth) => run(auth, args.agent_id, async () => {
			const p = await portfolioWithSnapshot({ agentId: args.agent_id, network: args.network || 'mainnet' });
			if (!p) return refusal('No agent with that id.', 'not_found');
			const max = args.max_holdings || 25;
			const holdings = p.holdings.slice(0, max);
			const lines = [
				`${p.agent.name} on ${p.network}${p.agent.wallet ? ` (${p.agent.wallet})` : ', no wallet provisioned'}`,
				`Net worth ${sol(p.net_worth.sol)} = ${usd(p.net_worth.usd)} (SOL ${usd(p.sol_usd)}). Realized ${sol(p.net_worth.realized_pnl_sol)}, unrealized ${sol(p.net_worth.unrealized_pnl_sol)}.`,
				holdings.length ? `Holdings (${p.holdings.length}):` : 'No holdings.',
				...holdings.map(holdingLine),
				p.holdings.length > max ? `(+${p.holdings.length - max} smaller holdings)` : null,
				p.risk_flags.length ? `Risk flags: ${p.risk_flags.map((f) => `${f.level}: ${f.text}`).join('; ')}` : 'No risk flags.',
			].filter(Boolean);
			return { content: [{ type: 'text', text: lines.join('\n') }], structuredContent: { ...p, holdings } };
		}),
	},
	{
		name: 'get_balance_history',
		title: "An agent's net-worth history",
		group: 'wallet',
		tier: 'read',
		annotations: HISTORY_READ,
		description: "How one of your agents' net worth moved over the last N days: recorded valuations (SOL, USD, realized and unrealized P&L at each point) with change, peak and max drawdown, plus the exact cumulative realized P&L per day from closed trades. Use this to chart or describe how an agent's net worth changed over time.",
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: agentIdProp,
				network: networkProp,
				days: { type: 'integer', minimum: 1, maximum: 365, default: 30 },
				max_points: { type: 'integer', minimum: 2, maximum: 500, default: 120, description: 'Thin the series to at most this many points; first and last stay exact.' },
			},
			required: ['agent_id'],
			additionalProperties: false,
		},
		handler: (args, auth) => run(auth, args.agent_id, async () => {
			const h = await getBalanceHistory({ agentId: args.agent_id, network: args.network || 'mainnet', days: args.days || 30, maxPoints: args.max_points || 120 });
			const s = h.summary;
			const curve = h.realized_curve;
			const lines = [
				`Net worth over ${h.days} days on ${h.network}: ${h.snapshot_count} recorded valuations.`,
				s ? `${sol(s.start_sol)} to ${sol(s.end_sol)} (${sol(s.change_sol)}, ${pct(s.change_pct)}); USD ${usd(s.start_usd)} to ${usd(s.end_usd)}. Peak ${sol(s.peak_sol)}, max drawdown ${pct(s.max_drawdown_pct)}.` : h.note,
				curve.length ? `Realized P&L by day (cumulative): ${curve.slice(-10).map((c) => `${c.date} ${sol(c.cumulative_realized_sol)}`).join(', ')}` : 'No trades closed in this window.',
			];
			return { content: [{ type: 'text', text: lines.join('\n') }], structuredContent: h };
		}),
	},
	{
		name: 'get_pnl',
		title: "An agent's profit and loss",
		group: 'wallet',
		tier: 'read',
		annotations: LIVE_READ,
		description: "Realized, unrealized and total P&L for one of your agents in SOL and USD, broken down by source (sniper, discretionary, strategies, x402 spend, withdrawals), with trading performance (win rate, ROI, profit factor, drawdown) and the biggest open winners and losers. Use this when the user asks whether an agent is making or losing money, and from what.",
		inputSchema: { type: 'object', properties: { agent_id: agentIdProp, network: networkProp }, required: ['agent_id'], additionalProperties: false },
		handler: (args, auth) => run(auth, args.agent_id, async () => {
			const p = await portfolioWithSnapshot({ agentId: args.agent_id, network: args.network || 'mainnet' });
			if (!p) return refusal('No agent with that id.', 'not_found');
			const d = pnlDigest(p);
			const t = d.totals;
			const perf = d.performance;
			const lines = [
				`${d.agent.name} on ${d.network}: total P&L ${sol(t.total_sol)} (${usd(t.total_usd)}), realized ${sol(t.realized_sol)}, unrealized ${sol(t.unrealized_sol)}.`,
				`Trades: ${perf.closed_trades} closed, ${perf.open_trades} open, win rate ${perf.win_rate == null || !perf.closed_trades ? 'n/a' : pct(perf.win_rate * 100)}, ROI ${perf.closed_trades ? pct(perf.roi_pct) : 'n/a'}, max drawdown ${pct(perf.max_drawdown_pct)}.`,
				d.by_source.length ? 'By source:' : 'No attributed P&L yet.',
				...d.by_source.map((b) => (b.is_outflow
					? `- ${b.label}: spent ${sol(b.spent_sol)} (${usd(b.spent_usd)})`
					: `- ${b.label}: realized ${sol(b.realized_sol)}, unrealized ${sol(b.unrealized_sol)}, ${b.sells} sells`)),
				d.top_winners.length ? `Top open winners: ${d.top_winners.map((h) => `${h.symbol || h.mint} ${sol(h.unrealized_sol)}`).join(', ')}` : null,
				d.top_losers.length ? `Top open losers: ${d.top_losers.map((h) => `${h.symbol || h.mint} ${sol(h.unrealized_sol)}`).join(', ')}` : null,
			].filter(Boolean);
			return { content: [{ type: 'text', text: lines.join('\n') }], structuredContent: d };
		}),
	},
];
