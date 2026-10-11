// `record_execution` — mark a pending copy intent as acted-on or dismissed.
// Write, not idempotent (a one-way pending → acted/dismissed transition; once
// transitioned the same intent can't be re-recorded).
//
// Wraps POST /api/copy/executions { id, action, tx_signature? }. Non-custodial:
// "acted" simply RECORDS that the copier executed the trade from their own wallet
// (optionally with the fill signature for their records). three.ws never signs or
// broadcasts — this closes the loop on an intent, it does not place an order.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';
import { shapeExecution } from '../lib/shapes.js';

export const def = {
	name: 'record_execution',
	title: 'Record acting on a copy intent',
	annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Resolve a PENDING copy intent (from get_executions) by recording how you handled it. action:"acted" records that you executed the mirrored trade from your own wallet (optionally with the on-chain tx_signature for your records); action:"dismissed" discards the intent without trading. NON-CUSTODIAL: this never signs, sends, or broadcasts a transaction; it only updates the intent\'s status after YOU traded. Not idempotent: it transitions pending → acted/dismissed once; an intent that already expired or was actioned returns "not_actionable". Returns the updated execution. Requires THREE_WS_API_KEY. Use this after you have traded (or chosen not to) on an intent from get_executions, so it leaves the pending inbox.',
	inputSchema: {
		id: z.string().uuid().describe('UUID of the pending copy intent (from get_executions with status:"pending").'),
		action: z.enum(['acted', 'dismissed']).describe('"acted" = you executed the trade yourself; "dismissed" = you skipped it.'),
		tx_signature: z
			.string()
			.min(1)
			.max(128)
			.optional()
			.describe('Optional Solana transaction signature of your fill, recorded only when action="acted".'),
	},
	async handler(args) {
		const data = await apiRequest('/api/copy/executions', {
			method: 'POST',
			body: {
				id: args.id,
				action: args.action,
				...(args.action === 'acted' && args.tx_signature ? { tx_signature: args.tx_signature } : {}),
			},
		});
		return { ok: true, execution: shapeExecution(data?.execution) };
	},
};
