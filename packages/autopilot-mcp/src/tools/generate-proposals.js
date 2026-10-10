// `generate_proposals` — run the agent's "mind" to produce real candidate actions. Write.
//
// Wraps POST /api/autopilot/proposals { action:'generate', agentId } →
//   { created, autoRan, source, scanned, trust }.
// Generation reads the agent's high-salience memories + pending reflections and
// synthesizes concrete, provenance-cited proposals, persisting them to the queue.
// Reversible proposals the owner scoped for auto-execution may run immediately
// (server-side); irreversible SOL transfers never auto-run — they stay pending.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'generate_proposals',
	title: 'Generate autopilot proposals',
	// Write: persists new proposals (and may auto-run owner-scoped reversible ones),
	// but it is not itself a funds-moving/irreversible action.
	annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		"Run the agent's mind: read its high-salience memories and pending reflections and synthesize real, " +
		'concrete autopilot proposals — each citing the exact memories that justify it. New proposals are ' +
		'persisted to the queue (see list_proposals). WRITE: any reversible proposal the owner has scoped for ' +
		'auto-execution may run immediately and is reported under `autoRan`; irreversible SOL transfers ' +
		'never auto-run — they stay pending for explicit execute_proposal. Returns the created proposals, the ' +
		'autoRan receipts, the generation `source` (reflection | memory | heuristic), what was `scanned`, and ' +
		'updated trust. Deduped server-side, so calling it repeatedly will not enqueue duplicates. ' +
		'Use this to have the agent suggest its next actions from what it remembers; review the results with list_proposals before executing any.',
	inputSchema: {
		agentId: z
			.string()
			.min(1)
			.describe('UUID of the three.ws agent to generate proposals for. Must be an agent owned by the credential.'),
	},
	async handler(args) {
		const agentId = String(args?.agentId ?? '').trim();
		const data = await apiRequest('/api/autopilot/proposals', {
			method: 'POST',
			body: { action: 'generate', agentId },
		});
		const created = Array.isArray(data?.created) ? data.created : [];
		return {
			ok: true,
			agentId,
			created,
			createdCount: created.length,
			autoRan: Array.isArray(data?.autoRan) ? data.autoRan : [],
			source: data?.source ?? null,
			scanned: data?.scanned ?? null,
			trust: data?.trust ?? null,
		};
	},
};
