// `list_positions`: the agent wallet's valued holdings. READ-ONLY.
//
// Wraps GET /api/v1/agents/:id/portfolio, the same valued portfolio the
// dashboard shows (SOL plus every SPL position with USD value).

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';
import { agentIdArg } from '../lib/args.js';

export const def = {
	name: 'list_positions',
	title: 'List agent wallet positions',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
	description:
		'List what the agent wallet holds right now: native SOL and every token position with its balance and ' +
		'USD value, as valued by the platform. Use it to size a sell (tokenAmountRaw) or to confirm a fill landed.',
	inputSchema: {
		agentId: z.string().min(1).describe('UUID of the agent. Must be owned by the credential.'),
	},
	async handler(args) {
		const agentId = agentIdArg(args?.agentId);
		const data = await apiRequest(`/api/v1/agents/${agentId}/portfolio`);
		return { ok: true, agentId, portfolio: data?.data ?? data };
	},
};
