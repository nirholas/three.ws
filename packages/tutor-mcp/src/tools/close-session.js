// `close_session` — finalize a tutoring session and return its attested
// invoice. Write (state transition), but free: closing charges nothing.
//
// Wraps POST /api/tutor/session { sessionId, action: "end" }. The per-question
// answers are what cost money (billed at answer time); closing only seals the
// ledger. After close the session is locked — no further charges can be appended
// to it. Closing is idempotent: re-closing returns the same itemized total.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'close_session',
	title: 'Close a tutoring session (finalize invoice)',
	annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false, openWorldHint: true },
	description:
		'Finalize a Pay-As-You-Learn tutoring session and return its itemized, attested invoice. Seals the ledger for the given sessionId: status flips to "closed", a SHA-256 attestation is stamped over the line items and total, and no further questions can be billed to this session afterward. Returns sessionId, createdAt, closedAt, questionCount, the full lineItems array, the totalAtomics / totalUsd owed, and the attestation hash. Closing itself is FREE and moves no funds: the learner was already charged per answered question; this only produces the final receipt. Idempotent: closing an already-closed session returns the same total. Use this when the learner is done; call load_session first to review the tab before sealing it.',
	inputSchema: {
		sessionId: z
			.string()
			.min(1)
			.max(100)
			.describe('Opaque tutoring session identifier to finalize. Truncated to 100 chars by the API.'),
	},
	async handler(args) {
		const sessionId = String(args?.sessionId ?? '').trim().slice(0, 100);
		const invoice = await apiRequest('/api/tutor/session', {
			method: 'POST',
			body: { sessionId, action: 'end' },
		});
		return {
			ok: true,
			sessionId: invoice?.sessionId ?? sessionId,
			createdAt: invoice?.createdAt ?? null,
			closedAt: invoice?.closedAt ?? null,
			questionCount: invoice?.questionCount ?? 0,
			lineItems: Array.isArray(invoice?.lineItems) ? invoice.lineItems : [],
			totalAtomics: invoice?.totalAtomics ?? 0,
			totalUsd: invoice?.totalUsd ?? '0.000000',
			attestation: invoice?.attestation ?? null,
		};
	},
};
