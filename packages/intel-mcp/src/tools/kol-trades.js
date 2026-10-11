// `kol_trades` — recent KOL trades on a given mint. Read-only.
//
// Wraps GET /api/kol/trades?mint=<addr>&limit=<n>.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'kol_trades',
	title: 'Recent KOL trades on a mint',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'See which tracked KOL wallets have recently traded a specific mint. Returns the recent trades (buys/sells with size and timing) observed across the tracked KOL set, plus the size of that tracked set. Read-only live data. Use this to check whether known KOLs are in or out of a coin before acting on it; for the ranked trader list call kol_leaderboard.',
	inputSchema: {
		mint: z
			.string()
			.min(1)
			.describe('The token mint address to scan KOL activity for.'),
		limit: z
			.number()
			.int()
			.min(1)
			.max(100)
			.optional()
			.describe('How many recent trades to return (1–100, default 20).'),
	},
	async handler(args) {
		const mint = String(args?.mint ?? '').trim();
		const limit = args?.limit;
		const data = await apiRequest('/api/kol/trades', { query: { mint, limit } });
		const trades = Array.isArray(data?.trades) ? data.trades : [];
		return {
			ok: true,
			mint: data?.mint ?? mint,
			tracked_wallets: data?.wallets ?? 0,
			count: trades.length,
			trades,
		};
	},
};
