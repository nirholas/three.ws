// `get_autopilot_config` — read the agent's current autopilot guardrails. Read-only.
//
// Wraps GET /api/autopilot/config?agentId=<id> → { config, trust }.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'get_autopilot_config',
	title: 'Get autopilot config',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		"Read the agent's autopilot permission model: whether autopilot is enabled, which capability " +
		'scopes the owner granted (create_alert, briefing, wallet_transfer), which reversible scopes may ' +
		'auto-execute, the daily SOL spend ceiling (in SOL; 0 = no spending), and whether ' +
		'irreversible actions require explicit confirmation. Also returns the live trust level (sandbox → ' +
		'trusted → autonomous) computed from real action history. Nothing the agent can do exists outside ' +
		'these owner-granted scopes. Call this first, before proposing or executing. Read-only.',
	inputSchema: {
		agentId: z
			.string()
			.min(1)
			.describe('UUID of the three.ws agent whose autopilot config to read. Must be an agent owned by the credential.'),
	},
	async handler(args) {
		const agentId = String(args?.agentId ?? '').trim();
		const data = await apiRequest('/api/autopilot/config', { query: { agentId } });
		return {
			ok: true,
			agentId,
			config: data?.config ?? null,
			trust: data?.trust ?? null,
		};
	},
};
