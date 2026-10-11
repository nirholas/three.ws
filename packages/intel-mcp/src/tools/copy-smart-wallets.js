// `copy_smart_wallets` — the ranked copy-trade Smart Money directory. Read-only.
//
// Wraps GET /api/copy/smart-wallets?chain=&category=&sort=&q=&limit=&offset=.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'copy_smart_wallets',
	title: 'Copy-trade smart wallet directory',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Browse the curated Smart Money directory for copy-trading: deduplicated wallets ranked by 30-day performance. Filter by chain (sol/bsc) and category (smart_money, launchpad, kol, sniper), search by address/name/twitter, and sort by profit, pnl, winrate, followers, or score. Returns the ranked page (wallet identity + 30-day performance, never token mints), the total, pagination flags, and category/chain facets. Read-only live data. Use this to pick wallets worth copying or following; for one wallet\'s full reputation card call wallet_intel instead.',
	inputSchema: {
		chain: z
			.enum(['sol', 'bsc'])
			.optional()
			.describe('Filter by chain. Omit for all chains.'),
		category: z
			.enum(['smart_money', 'launchpad', 'kol', 'sniper'])
			.optional()
			.describe('Filter by gmgn smart-money category. Omit for all categories.'),
		sort: z
			.enum(['profit', 'pnl', 'winrate', 'followers', 'score'])
			.default('score')
			.describe('Ranking key (default score).'),
		q: z
			.string()
			.optional()
			.describe('Free-text match against wallet address, name, or twitter handle.'),
		limit: z
			.number()
			.int()
			.min(1)
			.max(100)
			.optional()
			.describe('Page size (1–100, default 30).'),
		offset: z
			.number()
			.int()
			.min(0)
			.optional()
			.describe('Page offset (default 0).'),
	},
	async handler(args) {
		const data = await apiRequest('/api/copy/smart-wallets', {
			query: {
				chain: args?.chain,
				category: args?.category,
				sort: args?.sort,
				q: args?.q,
				limit: args?.limit,
				offset: args?.offset,
			},
		});
		const wallets = Array.isArray(data?.wallets) ? data.wallets : [];
		return {
			ok: true,
			count: wallets.length,
			total: data?.total ?? wallets.length,
			offset: data?.offset ?? 0,
			limit: data?.limit ?? wallets.length,
			has_more: data?.has_more ?? false,
			facets: data?.facets ?? { byChain: {}, byCategory: {} },
			source: data?.source ?? null,
			generated_at: data?.generated_at ?? null,
			wallets,
		};
	},
};
