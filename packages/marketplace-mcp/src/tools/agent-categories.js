// `agent_categories` — list marketplace categories with published counts.
// Read-only.
//
// Wraps GET /api/marketplace/categories.

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'agent_categories',
	title: 'List agent marketplace categories',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'List the agent marketplace categories with the count of published agents in each, plus the overall total. Use this before browse_agents to get the category slugs it filters on. Read-only.',
	inputSchema: {},
	async handler() {
		const data = await apiRequest('/api/marketplace/categories');
		const categories = Array.isArray(data?.data?.categories) ? data.data.categories : [];
		return {
			ok: true,
			total: data?.data?.total ?? 0,
			categories,
		};
	},
};
