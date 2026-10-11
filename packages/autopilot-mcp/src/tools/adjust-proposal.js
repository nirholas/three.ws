// `adjust_proposal` — edit a pending proposal's params before executing. Write, idempotent.
//
// Wraps POST /api/autopilot/proposals { action:'adjust', agentId, proposalId, params }
//   → { proposal }. The new params are validated server-side against the proposal's
// kind; an invalid edit is rejected with the reason. Only a pending proposal can be
// adjusted. Re-applying the same params yields the same proposal — idempotent.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'adjust_proposal',
	title: 'Adjust a pending autopilot proposal',
	annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
	description:
		"Edit a pending proposal's params before executing it — tune a threshold, swap a briefing cadence, " +
		'correct a transfer amount/recipient. The new params are validated SERVER-SIDE against the proposal ' +
		'kind and shape: ' +
		'create_alert → { asset:"three"|<mint>, condition:"price_above"|"price_below"|"graduation"|"whale_buy", ' +
		'threshold_usd?|threshold_sol? }; ' +
		'briefing → { summary, cadence:"once"|"daily"|"weekly", topic }; ' +
		'wallet_transfer → { recipient:<solana addr>, amount_sol:number, reason? }. ' +
		'An invalid edit is rejected with the reason and nothing changes. Only a pending proposal can be ' +
		'adjusted. WRITE but idempotent (no action taken; re-applying the same params is a no-op). For alerts ' +
		'the only coin is $THREE (asset:"three"); wallet_transfer sends SOL only and never sells or sends ' +
		'$THREE. Returns the updated proposal. ' +
		'Use this when a proposal is right in kind but wrong in detail; adjust it, run dryrun_proposal again, then execute_proposal.',
	inputSchema: {
		agentId: z
			.string()
			.min(1)
			.describe('UUID of the agent that owns the proposal. Must be an agent owned by the credential.'),
		proposalId: z
			.string()
			.min(1)
			.describe('UUID of the pending proposal to adjust.'),
		params: z
			.record(z.any())
			.describe('The full replacement params object for the proposal, matching its kind (see description). Validated server-side.'),
	},
	async handler(args) {
		const agentId = String(args?.agentId ?? '').trim();
		const proposalId = String(args?.proposalId ?? '').trim();
		const params = args?.params && typeof args.params === 'object' ? args.params : {};
		const data = await apiRequest('/api/autopilot/proposals', {
			method: 'POST',
			body: { action: 'adjust', agentId, proposalId, params },
		});
		return { ok: true, agentId, proposalId, proposal: data?.proposal ?? null };
	},
};
