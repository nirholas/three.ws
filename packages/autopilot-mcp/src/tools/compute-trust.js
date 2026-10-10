// `compute_trust` — the agent's computed trust/reputation level. Read-only.
//
// Wraps GET /api/autopilot/config?agentId=<id> and returns just the trust block.
// Trust is derived server-side from REAL action history (executions kept vs.
// undone/dismissed), not a vanity number.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'compute_trust',
	title: 'Compute autopilot trust level',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		"The agent's earned trust level, computed from its REAL autopilot history. Returns level " +
		'(sandbox → trusted → autonomous), a 0+ score (net kept executions weighted by reliability), the ' +
		'underlying stats (executed / undone / dismissed / pending counts + reliability %), and what it ' +
		'takes to reach the next level. Trust rises as the owner keeps the agent\'s actions and falls when ' +
		'they undo or dismiss them; it is not configurable, only earned. Read-only. ' +
		'Use this to tell the owner how much autonomy the agent has earned; for the full permission model call get_autopilot_config.',
	inputSchema: {
		agentId: z
			.string()
			.min(1)
			.describe('UUID of the three.ws agent whose trust to compute. Must be an agent owned by the credential.'),
	},
	async handler(args) {
		const agentId = String(args?.agentId ?? '').trim();
		const data = await apiRequest('/api/autopilot/config', { query: { agentId } });
		return {
			ok: true,
			agentId,
			trust: data?.trust ?? null,
		};
	},
};
