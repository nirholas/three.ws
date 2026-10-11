// `get_trending_coins` — coins ranked by Oracle conviction. Read-only.
//
// Wraps GET /api/trending and returns the coins ranking — the platform launch
// directory's top Oracle-conviction coins, rendered from real launch records at
// runtime. This is discovery data, not an endorsement: the tool surfaces what
// the Oracle scored highest, it never markets or recommends any specific mint.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'get_trending_coins',
	title: 'Trending coins by Oracle conviction',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		"The coins three.ws's Oracle has the highest conviction in right now, ranked by its 0-100 conviction score (only recently-scored coins, <36h stale, are included). Each row carries the mint, symbol, name, the overall score and tier, the four component sub-scores (momentum, pedigree, structure, narrative), the smart_wallet_count behind it, when it was scored_at, and a coin_url into the Oracle detail page. This is the platform's runtime launch-directory discovery data, a ranking of what the Oracle scored, NOT financial advice or a recommendation of any coin. Read-only live data; the ranking moves between calls. Use this to see which coins the Oracle rates highest right now; for the agents ranking call get_trending_agents.",
	inputSchema: {
		limit: z
			.number()
			.int()
			.min(1)
			.max(20)
			.optional()
			.describe('How many ranked coins to return (1–20, default 10).'),
	},
	async handler(args) {
		const limit = args?.limit;
		const data = await apiRequest('/api/trending', { query: { limit } });
		const coins = Array.isArray(data?.coins) ? data.coins : [];
		return {
			ok: true,
			generated_at: data?.generated_at ?? null,
			count: coins.length,
			coins,
		};
	},
};
