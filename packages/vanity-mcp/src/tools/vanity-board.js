// `vanity_board` — browse the grind-bounty market board. Read-only.
//
// Wraps GET /api/vanity/bounties?view=board. The board changes as bounties are
// posted, claimed, and expire, so it is NOT idempotent.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'vanity_board',
	title: 'Browse the vanity grind-bounty board',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Browse the public grind-bounty board: vanity-address bounties requesters have escrowed for the worker fleet to grind. Filter by status (open / all / settled), sort by recency, reward, or expiry, and paginate. Each bounty shows its pattern, USDC amount, difficulty, status, and timing. Use this to see what bounties exist and what they pay; workers looking for claimable work should call vanity_open. Read-only; posting a bounty is a separate x402-paid write on the HTTP API.',
	inputSchema: {
		status: z.enum(['open', 'all', 'settled']).default('open').describe('Which bounties to list. Default open.'),
		sort: z.enum(['recency', 'reward', 'expiry']).default('recency').describe('Order: newest first, biggest reward first, or soonest to expire. Default recency.'),
		limit: z.number().int().min(1).max(100).optional().describe('Max bounties to return (1–100, default 24).'),
		offset: z.number().int().min(0).optional().describe('Pagination offset (default 0).'),
	},
	async handler(args) {
		const data = await apiRequest('/api/vanity/bounties', {
			query: {
				view: 'board',
				status: args?.status || 'open',
				sort: args?.sort || 'recency',
				limit: args?.limit,
				offset: args?.offset,
			},
		});
		return { ok: true, ...data };
	},
};
