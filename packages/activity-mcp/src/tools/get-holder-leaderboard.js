// `get_holder_leaderboard` — the public $THREE holder leaderboard. Read-only.
//
// Wraps GET /api/leaderboard?limit=<n>&offset=<n>&wallet=<base58>. $THREE is the
// only coin three.ws ranks holders for; the board is derived from the live
// on-chain holder set.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'get_holder_leaderboard',
	title: '$THREE holder leaderboard',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		"The public $THREE holder leaderboard, ranked by on-chain balance. $THREE is the only coin three.ws ranks holders for. Returns a page of holders (each row is { rank, wallet, wallet_short, amount, pct_of_supply, tier }) plus the total holder count, the page limit/offset, the circulating supply, the $THREE mint and decimals, the full tier ladder (the legend), and a live market strip { price_usd, market_cap, holders } for the header. Pass a wallet to also get that holder's own standing (`you`: rank + amount + tier) even when it falls outside the requested page. Read-only live data; balances and ranks move between calls. Use this to look up where a wallet ranks among $THREE holders or to page through the board; for the tier thresholds alone call get_tier_info.",
	inputSchema: {
		limit: z
			.number()
			.int()
			.min(1)
			.max(100)
			.optional()
			.describe('Page size — how many ranked holders to return (1–100, default 50).'),
		offset: z
			.number()
			.int()
			.min(0)
			.optional()
			.describe('Page offset into the ranking (default 0). Combine with limit to page through the board.'),
		wallet: z
			.string()
			.trim()
			.optional()
			.describe("Optional base58 Solana wallet. When supplied, the response's `you` field reports that wallet's own rank, amount, % of supply, and tier even if it's outside the page."),
	},
	async handler(args) {
		const limit = args?.limit;
		const offset = args?.offset;
		const wallet = typeof args?.wallet === 'string' ? args.wallet.trim() : undefined;
		const data = await apiRequest('/api/leaderboard', { query: { limit, offset, wallet } });
		const holders = Array.isArray(data?.holders) ? data.holders : [];
		return {
			ok: true,
			mint: data?.mint ?? null,
			total: Number(data?.total) || 0,
			limit: Number(data?.limit) || holders.length,
			offset: Number(data?.offset) || 0,
			count: holders.length,
			supply: data?.supply ?? null,
			decimals: data?.decimals ?? null,
			holders,
			tiers: Array.isArray(data?.tiers) ? data.tiers : [],
			market: data?.market ?? null,
			you: data?.you ?? null,
			ts: data?.ts ?? null,
		};
	},
};
