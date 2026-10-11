// `execute_proposal` — take the real action a proposal describes. WRITE · DESTRUCTIVE.
//
// Wraps POST /api/autopilot/proposals { action:'execute', agentId, proposalId, confirm? }
//   → { proposal, receipt, action, trust }.
//
// This is the funds-touching endpoint. A `wallet_transfer` proposal moves REAL
// SOL on Solana mainnet and is IRREVERSIBLE — it requires confirm:true (unless
// the owner durably pre-authorized it) and is capped by the daily SOL budget.
// It sends native SOL only — the agent never sells or sends $THREE.
// `create_alert` and `briefing` are real writes too, but reversible via undo_action.
// Scope, confirmation, and spend caps are all enforced SERVER-SIDE — this tool
// cannot bypass them; an out-of-scope or over-budget call is denied, not executed.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'execute_proposal',
	title: 'Execute an autopilot proposal (moves real value)',
	// EXECUTION: a wallet_transfer proposal moves real SOL on mainnet, irreversible.
	annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
	description:
		'EXECUTE a proposal for real, within the owner-granted scope. ⚠️ This is the funds-touching action: a ' +
		'`wallet_transfer` proposal sends REAL SOL on Solana mainnet and is IRREVERSIBLE — you MUST pass ' +
		'confirm:true for it (unless the owner durably pre-authorized that scope), and it is capped by the ' +
		'daily SOL budget. It sends native SOL only — never $THREE. `create_alert` and `briefing` are real writes but reversible via undo_action. ' +
		'Use this after dryrun_proposal shows no blocked check and, for a wallet_transfer, after the owner has explicitly confirmed it. Scope, confirmation, and spend caps are enforced SERVER-SIDE; this tool ' +
		'cannot override them — an out-of-scope, over-budget, or unconfirmed call is denied (no action taken). ' +
		'Returns the updated proposal, a human receipt, the signed action-log id, and updated trust.',
	inputSchema: {
		agentId: z
			.string()
			.min(1)
			.describe('UUID of the agent that owns the proposal. Must be an agent owned by the credential.'),
		proposalId: z
			.string()
			.min(1)
			.describe('UUID of the pending proposal to execute (from list_proposals or generate_proposals).'),
		confirm: z
			.boolean()
			.optional()
			.describe('Must be true to execute an irreversible SOL wallet_transfer (when require_confirm is on). Ignored for reversible kinds.'),
	},
	async handler(args) {
		const agentId = String(args?.agentId ?? '').trim();
		const proposalId = String(args?.proposalId ?? '').trim();
		const body = { action: 'execute', agentId, proposalId };
		if (args?.confirm === true) body.confirm = true;
		const data = await apiRequest('/api/autopilot/proposals', { method: 'POST', body });
		return {
			ok: true,
			agentId,
			proposalId,
			proposal: data?.proposal ?? null,
			receipt: data?.receipt ?? null,
			action: data?.action ?? null,
			actionId: data?.action?.id != null ? String(data.action.id) : null,
			trust: data?.trust ?? null,
		};
	},
};
