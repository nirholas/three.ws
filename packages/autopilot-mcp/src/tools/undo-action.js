// `undo_action` — reverse a reversible executed proposal. Write.
//
// Wraps POST /api/autopilot/proposals { action:'undo', agentId, proposalId } → { proposal, trust }.
// Deletes the real artifact the execution created (the alert rule or the briefing
// notification) and records a feedback memory so the agent learns the boundary.
// A SOL wallet_transfer is on-chain and CANNOT be undone — the server rejects it.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'undo_action',
	title: 'Undo a reversible autopilot action',
	// Write: reverses a prior execution. Not destructive — it removes the created
	// artifact and is the corrective path, not a value-moving action.
	annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Reverse a reversible executed proposal: deletes the real artifact the execution created — the alert ' +
		'rule (create_alert) or the briefing notification (briefing) — and records a feedback memory so the ' +
		'agent learns to be more conservative next time. WRITE. NOTE: an irreversible SOL wallet_transfer ' +
		'is on-chain and cannot be undone — the server rejects that with `irreversible`; to send value back ' +
		'you would have to execute a new transfer. Returns the updated proposal (status → undone) and trust. ' +
		'Use this when the owner wants a reversible executed action taken back; to reject a proposal that never ran call dismiss_proposal.',
	inputSchema: {
		agentId: z
			.string()
			.min(1)
			.describe('UUID of the agent that owns the proposal. Must be an agent owned by the credential.'),
		proposalId: z
			.string()
			.min(1)
			.describe('UUID of the executed proposal to undo.'),
	},
	async handler(args) {
		const agentId = String(args?.agentId ?? '').trim();
		const proposalId = String(args?.proposalId ?? '').trim();
		const data = await apiRequest('/api/autopilot/proposals', {
			method: 'POST',
			body: { action: 'undo', agentId, proposalId },
		});
		return {
			ok: true,
			agentId,
			proposalId,
			proposal: data?.proposal ?? null,
			trust: data?.trust ?? null,
		};
	},
};
