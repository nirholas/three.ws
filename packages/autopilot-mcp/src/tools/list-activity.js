// `list_autopilot_activity` — the signed receipts feed of past autonomous actions. Read-only.
//
// Wraps GET /api/autopilot/activity?agentId=&limit=&cursor= → { receipts, next_cursor, agents, trust }.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'list_autopilot_activity',
	title: 'List autopilot activity (signed receipts)',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Read the append-only log of every autonomous action the agent has taken, newest first — the real ' +
		'agent_actions trail. Each receipt carries the kind (alert created / briefing authored / wallet ' +
		'transfer), its rationale, the outcome (created rule id / notification id / on-chain signature), the ' +
		'source memories it was grounded in, and the cryptographic signature + signer address when the ' +
		'action was signed by the agent\'s wallet. Use it to audit what the agent did and why. Omit agentId ' +
		'to aggregate across every agent the credential owns. Paginate with the returned next_cursor. Read-only.',
	inputSchema: {
		agentId: z
			.string()
			.min(1)
			.optional()
			.describe('UUID of a specific agent (must be owned by the credential). Omit to aggregate across all your agents.'),
		limit: z
			.number()
			.int()
			.min(1)
			.max(200)
			.optional()
			.describe('Max receipts per page (1–200, default 50).'),
		cursor: z
			.string()
			.regex(/^\d+$/)
			.optional()
			.describe('Pagination cursor: pass the next_cursor from a previous call to fetch the next page.'),
	},
	async handler(args) {
		const query = {};
		if (args?.agentId) query.agentId = String(args.agentId).trim();
		if (args?.limit != null) query.limit = args.limit;
		if (args?.cursor) query.cursor = String(args.cursor);
		const data = await apiRequest('/api/autopilot/activity', { query });
		const receipts = Array.isArray(data?.receipts) ? data.receipts : [];
		return {
			ok: true,
			count: receipts.length,
			receipts,
			next_cursor: data?.next_cursor ?? null,
			agents: Array.isArray(data?.agents) ? data.agents : [],
			trust: data?.trust ?? null,
		};
	},
};
