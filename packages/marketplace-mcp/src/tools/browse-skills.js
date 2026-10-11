// `browse_skills` — search and page the public three.ws skills catalog.
// Read-only.
//
// Wraps GET /api/skills?q=&category=&sort=&limit=&cursor=.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'browse_skills',
	title: 'Browse the skills catalog',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Search and page the public three.ws skills catalog: reusable tools and capabilities agents can install. Filter by free-text query and category, choose a sort order, and get back a list of skills (id, name, slug, description, category, tags, install count, rating, per-call price, author, content preview) plus a cursor for the next page. Use this to find an installable skill for a capability an agent lacks; filter with slugs from skill_categories. Read-only.',
	inputSchema: {
		q: z.string().optional().describe('Free-text search across skill name, description, and tags.'),
		category: z.string().optional().describe('Restrict to one category slug (e.g. "general").'),
		sort: z
			.enum(['popular', 'new', 'az'])
			.default('popular')
			.describe('Sort order: "popular" (default, by install count), "new" (most recent), or "az" (A–Z).'),
		limit: z
			.number()
			.int()
			.min(1)
			.max(50)
			.optional()
			.describe('How many skills to return (1–50, default 20).'),
		cursor: z
			.string()
			.optional()
			.describe('Opaque pagination cursor from a previous response\'s next_cursor.'),
	},
	async handler(args) {
		const data = await apiRequest('/api/skills', {
			query: {
				q: args?.q,
				category: args?.category,
				sort: args?.sort,
				limit: args?.limit,
				cursor: args?.cursor,
			},
		});
		const skills = Array.isArray(data?.skills) ? data.skills : [];
		return {
			ok: true,
			skills,
			next_cursor: data?.next_cursor ?? null,
		};
	},
};
