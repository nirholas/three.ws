// `skill_categories` — list skills catalog categories with counts. Read-only.
//
// Wraps GET /api/skills/categories.

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'skill_categories',
	title: 'List skills catalog categories',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'List the skills catalog categories that have at least one public skill, each with a slug, label, and the count of skills in it. Use this before browse_skills to get the category slugs it filters on. Read-only.',
	inputSchema: {},
	async handler() {
		const data = await apiRequest('/api/skills/categories');
		const categories = Array.isArray(data?.categories) ? data.categories : [];
		return { ok: true, categories };
	},
};
