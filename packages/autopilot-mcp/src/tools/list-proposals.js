// `list_proposals` — the agent's autopilot proposal queue. Read-only.
//
// Wraps GET /api/autopilot/proposals?agentId=&status=&limit= → { proposals, trust, config }.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'list_proposals',
	title: 'List autopilot proposals',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'List the agent\'s autopilot proposals — candidate actions it generated, each grounded in cited ' +
		'memories (provenance hydrated). Each proposal carries its id (needed for dryrun/execute/dismiss/' +
		'undo/adjust), kind (create_alert | briefing | wallet_transfer), title, plain-language rationale ' +
		'(the receipt), params, confidence, requiresConfirmation, status, result, and the source memories. ' +
		'Use this to find what is actionable (filter by status) and to get the proposal ids the other autopilot tools need. Also returns the current config + trust for context. ' +
		'Read-only.',
	inputSchema: {
		agentId: z
			.string()
			.min(1)
			.describe('UUID of the three.ws agent whose proposals to list. Must be an agent owned by the credential.'),
		status: z
			.enum(['pending', 'executed', 'dismissed', 'undone', 'failed'])
			.optional()
			.describe('Filter to one lifecycle status. Omit to return all statuses (newest first).'),
		limit: z
			.number()
			.int()
			.min(1)
			.max(200)
			.optional()
			.describe('Max proposals to return (1–200, default 50).'),
	},
	async handler(args) {
		const agentId = String(args?.agentId ?? '').trim();
		const query = { agentId };
		if (args?.status) query.status = args.status;
		if (args?.limit != null) query.limit = args.limit;
		const data = await apiRequest('/api/autopilot/proposals', { query });
		const proposals = Array.isArray(data?.proposals) ? data.proposals : [];
		return {
			ok: true,
			agentId,
			count: proposals.length,
			proposals,
			trust: data?.trust ?? null,
			config: data?.config ?? null,
		};
	},
};
