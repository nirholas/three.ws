// `vanity_leaderboard` — top grinders by USDC earned. Read-only.
//
// Wraps GET /api/vanity/bounties?view=leaderboard. The ranking shifts as workers
// win bounties — NOT idempotent.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'vanity_leaderboard',
	title: 'Top grinders by USDC earned',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Rank the worker fleet: the top grinders by total USDC earned from winning vanity-address bounties. Each entry shows a worker id and its cumulative payout. Use this to see who is winning bounties; for market totals call vanity_stats. Read-only.',
	inputSchema: {
		limit: z.number().int().min(1).max(100).default(10).describe('How many top grinders to return (1–100, default 10).'),
	},
	async handler(args) {
		const data = await apiRequest('/api/vanity/bounties', {
			query: { view: 'leaderboard', limit: args?.limit ?? 10 },
		});
		return {
			ok: true,
			grinders: data?.grinders ?? [],
			count: data?.count ?? (Array.isArray(data?.grinders) ? data.grinders.length : 0),
		};
	},
};
