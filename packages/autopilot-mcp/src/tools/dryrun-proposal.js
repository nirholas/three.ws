// `dryrun_proposal` — non-mutating preview of what executing a proposal would do. Read-only.
//
// Wraps POST /api/autopilot/proposals { action:'dryrun', agentId, proposalId } → { preview }.
// It is a POST, but takes NO action: it only resolves params, checks scope/cap/
// balance, and reports what WOULD happen — so it is annotated read-only.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'dryrun_proposal',
	title: 'Dry-run an autopilot proposal',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Preview exactly what executing a proposal WOULD do, without taking any action. Returns the kind, a ' +
		'plain-language "willDo" sentence, and a checklist of guard checks (scope granted? params valid? ' +
		'within the daily SOL cap? wallet balance covers a transfer?) plus a `blocked` flag if any check ' +
		'fails. Use this before every execute_proposal, and always before an irreversible wallet_transfer. Performs a live balance ' +
		'read but no write and no spend — safe to call freely. Read-only.',
	inputSchema: {
		agentId: z
			.string()
			.min(1)
			.describe('UUID of the agent that owns the proposal. Must be an agent owned by the credential.'),
		proposalId: z
			.string()
			.min(1)
			.describe('UUID of the proposal to preview (from list_proposals or generate_proposals).'),
	},
	async handler(args) {
		const agentId = String(args?.agentId ?? '').trim();
		const proposalId = String(args?.proposalId ?? '').trim();
		const data = await apiRequest('/api/autopilot/proposals', {
			method: 'POST',
			body: { action: 'dryrun', agentId, proposalId },
		});
		return { ok: true, agentId, proposalId, preview: data?.preview ?? null };
	},
};
