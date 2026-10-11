// `load_session` — read a tutoring session's running tab. Read-only, free.
//
// Wraps GET /api/tutor/session?sessionId=<id>. Viewing what you owe is never
// charged: this returns the itemized ledger for an open or closed session so an
// agent can resume a learner's tab or audit the line items before closing.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'load_session',
	title: 'Load a tutoring session ledger',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Read the running tab for a Pay-As-You-Learn tutoring session by its sessionId. Returns the itemized ledger: one lineItem per answered question (question text, level, output tokens, per-item cost in USDC atomics and a "$x.xxxxxx" string, and the timestamp), plus the session status ("open" | "closed"), questionCount, and the running totalAtomics / totalUsd. If the session was already closed it also returns the finalized, attested invoice. A sessionId with no stored history returns an empty open session (questionCount 0) rather than an error; that is an honest "nothing billed yet", not a failure. Viewing the tab is always free; this never charges the learner. Use this to show the learner what they owe so far; to seal the invoice call close_session. Read-only live data.',
	inputSchema: {
		sessionId: z
			.string()
			.min(1)
			.max(100)
			.describe('Opaque tutoring session identifier (the id the session was opened with). Truncated to 100 chars by the API.'),
	},
	async handler(args) {
		const sessionId = String(args?.sessionId ?? '').trim().slice(0, 100);
		const data = await apiRequest('/api/tutor/session', { query: { sessionId } });
		return {
			ok: true,
			sessionId: data?.sessionId ?? sessionId,
			status: data?.status ?? 'open',
			createdAt: data?.createdAt ?? null,
			questionCount: data?.questionCount ?? 0,
			lineItems: Array.isArray(data?.lineItems) ? data.lineItems : [],
			totalAtomics: data?.totalAtomics ?? 0,
			totalUsd: data?.totalUsd ?? '0.000000',
			...(data?.invoice ? { invoice: data.invoice } : {}),
		};
	},
};
