// `dismiss_proposal` — drop a pending proposal the agent shouldn't act on. Write.
//
// Wraps POST /api/autopilot/proposals { action:'dismiss', agentId, proposalId } → { proposal, trust }.
// Records a feedback memory ("don't propose this again") so future generation
// steers away from it. Only a pending proposal can be dismissed.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'dismiss_proposal',
	title: 'Dismiss a pending autopilot proposal',
	annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Dismiss a pending proposal the agent decided not to act on. Marks it dismissed and records a ' +
		'feedback memory ("don\'t propose this again") so future generate_proposals steers away from it — ' +
		'this is how the agent learns the owner\'s boundaries. WRITE. Only a pending proposal can be ' +
		'dismissed (executed/undone/dismissed ones are rejected). Returns the updated proposal and trust. ' +
		'Use this when the owner rejects a proposal, so the agent stops suggesting it; to reverse something already executed call undo_action instead.',
	inputSchema: {
		agentId: z
			.string()
			.min(1)
			.describe('UUID of the agent that owns the proposal. Must be an agent owned by the credential.'),
		proposalId: z
			.string()
			.min(1)
			.describe('UUID of the pending proposal to dismiss.'),
	},
	async handler(args) {
		const agentId = String(args?.agentId ?? '').trim();
		const proposalId = String(args?.proposalId ?? '').trim();
		const data = await apiRequest('/api/autopilot/proposals', {
			method: 'POST',
			body: { action: 'dismiss', agentId, proposalId },
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
