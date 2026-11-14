// `list_positions`: the agent wallet's valued holdings. READ-ONLY.
//
// Wraps GET /api/v1/agents/:id/portfolio, the same valued portfolio the
// dashboard shows, and returns the part a trading decision needs: native SOL,
// every token position with its USD value and FIFO cost basis / unrealized
// P&L in SOL, net worth, and the risk flags. The dashboard's attribution and
// metric series are left out to keep the result small.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';
import { agentIdArg } from '../lib/args.js';

export const def = {
	name: 'list_positions',
	title: 'List agent wallet positions',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
	description:
		'List what the agent wallet holds right now: native SOL and every token position with its balance, USD value, ' +
		'cost basis and unrealized P&L in SOL, plus net worth and risk flags. Use it to pick a sell and size it ' +
		'(pass amountTokens: "all" or an amount to quote_trade), or to confirm a fill landed. sellable:false marks ' +
		'$THREE, which the agent never sells.',
	inputSchema: {
		agentId: z.string().min(1).describe('UUID of the agent. Must be owned by the credential.'),
	},
	async handler(args) {
		const agentId = agentIdArg(args?.agentId);
		const data = await apiRequest(`/api/v1/agents/${agentId}/portfolio`);
		return { ok: true, agentId, ...summarizePositions(data?.data ?? data) };
	},
};

const orNull = (v) => (v === undefined ? null : v);

/** The decision-relevant slice of a portfolio response. Pure. */
export function summarizePositions(portfolio) {
	const holdings = Array.isArray(portfolio?.holdings) ? portfolio.holdings : [];
	const native = holdings.find((h) => h.isNative);
	const nw = portfolio?.net_worth || {};
	return {
		wallet: portfolio?.agent?.wallet ?? null,
		network: portfolio?.network ?? null,
		sol_usd: orNull(portfolio?.sol_usd),
		sol: { amount: native?.amount ?? 0, usd_value: orNull(native?.usd_value) },
		positions: holdings.filter((h) => !h.isNative && h.mint).map((h) => ({
			mint: h.mint,
			symbol: orNull(h.symbol),
			name: orNull(h.name),
			amount: orNull(h.amount),
			decimals: orNull(h.decimals),
			price_usd: orNull(h.price),
			usd_value: orNull(h.usd_value),
			cost_basis_sol: orNull(h.cost_basis_sol),
			unrealized_sol: orNull(h.unrealized_sol),
			unrealized_pct: orNull(h.unrealized_pct),
			priceable: h.priceable === true,
			sellable: h.is_three !== true,
		})),
		net_worth: {
			sol: orNull(nw.sol),
			usd: orNull(nw.usd),
			realized_pnl_sol: orNull(nw.realized_pnl_sol),
			unrealized_pnl_sol: orNull(nw.unrealized_pnl_sol),
		},
		risk_flags: (Array.isArray(portfolio?.risk_flags) ? portfolio.risk_flags : []).map((f) => `${f.level}: ${f.text}`),
	};
}
