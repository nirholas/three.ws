// `browse_agents` — search and page the public three.ws agent marketplace.
// Read-only.
//
// Wraps GET /api/marketplace/agents?category=&q=&sort=&limit=&cursor=.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'browse_agents',
	title: 'Browse the agent marketplace',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Search and page the public three.ws agent marketplace. Filter by category and free-text query, choose a sort order, and get back a list of agent cards (id, name, description, category, tags, ratings, view/fork counts, thumbnail and GLB avatar URLs) plus a cursor for the next page. Use this to find agents by topic or popularity; call agent_detail on a result for its full profile. Read-only.',
	inputSchema: {
		category: z
			.string()
			.optional()
			.describe('Restrict to one category slug (e.g. "programming", "marketing", "education").'),
		q: z.string().optional().describe('Free-text search across agent name, description, and tags.'),
		sort: z
			.enum(['recommended', 'recent', 'popular', 'top_rated'])
			.default('recommended')
			.describe('Sort order: "recommended" (default), "recent", "popular", or "top_rated".'),
		limit: z
			.number()
			.int()
			.min(1)
			.max(48)
			.optional()
			.describe('How many agents to return (1–48, default 24).'),
		cursor: z
			.string()
			.optional()
			.describe('Opaque pagination cursor from a previous response\'s next_cursor.'),
	},
	async handler(args) {
		const data = await apiRequest('/api/marketplace/agents', {
			query: {
				category: args?.category,
				q: args?.q,
				sort: args?.sort,
				limit: args?.limit,
				cursor: args?.cursor,
			},
		});
		const items = Array.isArray(data?.data?.items) ? data.data.items : [];
		return {
			ok: true,
			items,
			next_cursor: data?.data?.next_cursor ?? null,
		};
	},
};
