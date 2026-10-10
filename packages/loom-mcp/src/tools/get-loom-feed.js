// `get_loom_feed` — browse the public Loom gallery of community-forged 3D
// creations, newest-first. Read-only.
//
// Wraps GET /api/loom?limit=&before= → { creations, nextBefore }.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';
import { decorateCreation } from '../lib/viewer.js';

export const def = {
	name: 'get_loom_feed',
	title: 'Browse the Loom 3D-creation gallery',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Browse Loom — the public, world-readable gallery of community-forged 3D creations (a forged GLB plus ' +
		'the prompt that made it and a bit of attribution), returned newest-first. Each creation includes its ' +
		'id, prompt, glbUrl, previewImageUrl, author, tier, backend, createdAt (ms epoch), plus a ready-to-use ' +
		'`viewer_url` (the /forge/embed orbit+AR viewer), `og_image_url`, and a paste-ready `iframe_snippet`. ' +
		'Paginate backwards with `before`: pass the `nextBefore` cursor from the previous page to load older ' +
		'items; a null `nextBefore` means you reached the end. Use this to browse or pick recent community ' +
		'creations; for one known id call get_creation instead. Read-only, no key required.',
	inputSchema: {
		limit: z
			.number()
			.int()
			.min(1)
			.max(120)
			.optional()
			.describe('How many creations to return (1–120, default 60).'),
		before: z
			.number()
			.int()
			.positive()
			.optional()
			.describe('Pagination cursor (ms epoch): return only creations older than this. Pass the prior page\'s nextBefore.'),
	},
	async handler(args) {
		const query = {};
		if (args?.limit != null) query.limit = args.limit;
		if (args?.before != null) query.before = args.before;
		const data = await apiRequest('/api/loom', { query });
		const creations = Array.isArray(data?.creations) ? data.creations.map(decorateCreation).filter(Boolean) : [];
		return {
			ok: true,
			count: creations.length,
			creations,
			nextBefore: data?.nextBefore ?? null,
			has_more: data?.nextBefore != null,
		};
	},
};
