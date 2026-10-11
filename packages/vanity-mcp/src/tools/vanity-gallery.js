// `vanity_gallery` — browse the proof-of-grind rarity gallery. Read-only.
//
// Wraps GET /api/vanity/gallery (default view). Published entries are added and
// removed over time, so the listing is NOT idempotent.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'vanity_gallery',
	title: 'Browse the proof-of-grind rarity gallery',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Browse the public proof-of-grind gallery: rare Solana addresses people have published with a verifiable grind receipt. Sort by rarity score or recency, filter by tier, minimum pattern length, or a substring the pattern must contain, and paginate. Each entry shows the address, pattern, rarity score/bits, tier, and an explorer link. Use this to browse published rare addresses; to score one address call vanity_appraise. Read-only.',
	inputSchema: {
		sort: z.enum(['score', 'recency']).default('score').describe('Order by rarity score (rarest first) or recency. Default score.'),
		tier: z.string().optional().describe('Filter to a single rarity tier id.'),
		minLength: z.number().int().min(0).optional().describe('Only patterns at least this many characters long.'),
		contains: z.string().optional().describe('Only addresses whose vanity pattern contains this substring.'),
		limit: z.number().int().min(1).max(100).optional().describe('Max entries to return (1–100, default 24).'),
		offset: z.number().int().min(0).optional().describe('Pagination offset (default 0).'),
	},
	async handler(args) {
		const data = await apiRequest('/api/vanity/gallery', {
			query: {
				view: 'gallery',
				sort: args?.sort || 'score',
				tier: args?.tier,
				minLength: args?.minLength,
				contains: args?.contains,
				limit: args?.limit,
				offset: args?.offset,
			},
		});
		return { ok: true, ...data };
	},
};
