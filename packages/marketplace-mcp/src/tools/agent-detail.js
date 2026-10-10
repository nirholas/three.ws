// `agent_detail` — fetch one published marketplace agent by id. Read-only.
//
// Wraps GET /api/marketplace/agents/<id>.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'agent_detail',
	title: 'Fetch a marketplace agent by id',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Fetch one published marketplace agent by its id, including its full detail: name, description, category, tags, system prompt, greeting, capabilities, author, ratings, skill prices, subscription tiers, and avatar URLs. Use this after browse_agents to read one agent\'s full profile, prices and tiers before hiring or forking it. Read-only.',
	inputSchema: {
		id: z.string().min(1).describe('The marketplace agent id (a UUID from a browse_agents card).'),
	},
	async handler(args) {
		const id = String(args?.id ?? '').trim();
		const data = await apiRequest(`/api/marketplace/agents/${encodeURIComponent(id)}`);
		const agent = data?.data?.agent;
		if (!agent) {
			throw Object.assign(new Error(`No marketplace agent found with id "${id}".`), {
				code: 'not_found',
				status: 404,
			});
		}
		return { ok: true, agent };
	},
};
