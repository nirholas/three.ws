// `set_autopilot_config` — update the agent's autopilot guardrails. Write, idempotent.
//
// Wraps POST /api/autopilot/config { agentId, ...patch } → { config }. The patch
// is merged server-side onto agent_identities.meta.autopilot; only the fields you
// pass change. Setting the same values twice yields the same config — idempotent.
// This does NOT take any action; it only adjusts the boundaries within which the
// agent may later act (scopes + spend caps are enforced server-side at execution).

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

const scopeFlags = z
	.object({
		create_alert: z.boolean().optional().describe('Allow creating real price/event alert rules.'),
		briefing: z.boolean().optional().describe('Allow authoring memory-grounded briefing notifications.'),
		wallet_transfer: z.boolean().optional().describe('Allow sending real SOL from the agent wallet (irreversible). Never sells or sends $THREE.'),
	})
	.partial();

export const def = {
	name: 'set_autopilot_config',
	title: 'Set autopilot config',
	// Write, but no action is taken and re-applying the same patch is a no-op.
	annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
	description:
		"Update the agent's autopilot guardrails. A partial patch — only the fields you pass change; the " +
		'rest are preserved. Set `enabled` to arm/disarm autopilot, `scopes` to grant/revoke each capability ' +
		'(create_alert, briefing, wallet_transfer), `autoExecute` to let reversible scopes run without review, ' +
		'`dailySpendSol` for the daily SOL outflow ceiling (in SOL; 0 disables spending), and ' +
		'`requireConfirm` to force explicit confirmation on irreversible actions. WRITE but idempotent: it ' +
		'changes only the boundaries, takes no action, and re-applying the same values is a no-op. Returns the ' +
		'full updated config. Scopes are enforced server-side at execution time — granting one here is what ' +
		'makes a later execute_proposal possible. ' +
		'Use this when the owner wants to grant, revoke, or cap what autopilot may do; read the current values first with get_autopilot_config.',
	inputSchema: {
		agentId: z
			.string()
			.min(1)
			.describe('UUID of the three.ws agent to configure. Must be an agent owned by the credential.'),
		enabled: z.boolean().optional().describe('Master switch — autopilot can only act when this is true.'),
		scopes: scopeFlags.optional().describe('Per-capability grants. Omitted keys keep their current value.'),
		autoExecute: z
			.object({
				create_alert: z.boolean().optional(),
				briefing: z.boolean().optional(),
			})
			.partial()
			.optional()
			.describe('Reversible scopes allowed to auto-execute on generation (wallet_transfer can never auto-run).'),
		dailySpendSol: z
			.number()
			.min(0)
			.optional()
			.describe('Daily ceiling on autonomous SOL outflow, in SOL (fractional allowed). 0 means no spending. The agent spends SOL, never $THREE.'),
		requireConfirm: z
			.boolean()
			.optional()
			.describe('When true (default), irreversible actions need explicit confirm:true at execution.'),
	},
	async handler(args) {
		const agentId = String(args?.agentId ?? '').trim();
		// Map the agent-facing camelCase args to the API's snake_case patch body.
		const body = { agentId };
		if (args?.enabled !== undefined) body.enabled = args.enabled === true;
		if (args?.scopes && typeof args.scopes === 'object') body.scopes = args.scopes;
		if (args?.autoExecute && typeof args.autoExecute === 'object') body.auto_execute = args.autoExecute;
		if (args?.dailySpendSol !== undefined) body.daily_spend_sol = args.dailySpendSol;
		if (args?.requireConfirm !== undefined) body.require_confirm = args.requireConfirm === true;

		const data = await apiRequest('/api/autopilot/config', { method: 'POST', body });
		return { ok: true, agentId, config: data?.config ?? null };
	},
};
