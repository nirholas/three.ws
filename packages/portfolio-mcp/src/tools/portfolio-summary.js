// `get_portfolio_summary` — live aggregated holdings + USD value across all of
// the agent wallets YOU own. Account-scoped (session). Read-only.
//
// Wraps GET /api/portfolio/summary. The route resolves the caller from the
// three.ws session, walks every agent identity they own (EVM + Solana), and
// returns live balances priced in USD per wallet plus a grand total. Pass
// `snapshot:true` to also persist a point-in-time snapshot that feeds
// get_portfolio_history.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'get_portfolio_summary',
	title: 'My agents’ live portfolio (holdings + USD value)',
	annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Live aggregated portfolio for the agent wallets YOU own (resolved from your three.ws session). Returns ' +
		'`total_usd` across all wallets and a per-wallet breakdown — each with agent_id, agent_name, chain ' +
		'(solana | evm), address, the resolved .sol name when present, the native balance (SOL/ETH amount + USD), ' +
		'the SPL/ERC-20 token holdings (amount + USD), and that wallet’s USD subtotal. A wallet that failed to ' +
		'price carries `ok:false` and an `error` instead of throwing the whole call. Note: this is the live VALUE ' +
		'snapshot — realized PnL lives in get_trades_feed. Set `snapshot:true` to persist a point for the history ' +
		'chart. Use this first for "what do my agents hold"; drill into one token with get_portfolio_asset. ' +
		'Requires THREE_WS_SESSION. Read-only unless `snapshot:true`, which writes one history point.',
	inputSchema: {
		snapshot: z
			.boolean()
			.default(false)
			.describe('When true, also persist this total as a portfolio snapshot (feeds get_portfolio_history). Default false.'),
	},
	async handler(args) {
		const data = await apiRequest('/api/portfolio/summary', {
			auth: true,
			query: args?.snapshot ? { snapshot: '1' } : undefined,
		});
		const wallets = Array.isArray(data?.wallets) ? data.wallets : [];
		return {
			ok: true,
			captured_at: data?.captured_at ?? null,
			total_usd: data?.total_usd ?? 0,
			wallet_count: wallets.length,
			wallets,
		};
	},
};
