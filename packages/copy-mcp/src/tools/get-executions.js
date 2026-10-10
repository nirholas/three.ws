// `get_executions` — the copier's copy-intent inbox + history. Read-only.
//
// Wraps GET /api/copy/executions?status=&limit=. Reading lazily expires stale
// pending intents server-side, so a 'pending' read always reflects what is still
// actionable right now.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';
import { shapeExecution } from '../lib/shapes.js';

export const def = {
	name: 'get_executions',
	title: 'List copy executions (intent inbox)',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'List the authenticated account\'s copy executions: the sized, guard-checked copy INTENTS generated when a followed leader trades. Each row carries the coin (mint/symbol/name), the mirrored direction (buy/sell), the planned SOL size, the leader, the safety/quote snapshot used for the decision, the lifecycle status, and any fill signature you recorded. Filter by status: "pending" (actionable now; the default), "acted", "dismissed", "skipped" (guard blocked it, with skip_reason), "expired", or "all". Reading refreshes the inbox: stale pending intents are expired automatically. Use this to see which copy intents are waiting on you, then call record_execution to mark each pending one acted or dismissed. Read-only; requires THREE_WS_API_KEY.',
	inputSchema: {
		status: z
			.enum(['pending', 'acted', 'dismissed', 'skipped', 'expired', 'all'])
			.default('pending')
			.describe('Lifecycle filter (default "pending" — only intents still actionable).'),
		limit: z.number().int().min(1).max(100).default(50).describe('Max rows to return, newest first (1–100, default 50).'),
	},
	async handler(args) {
		const data = await apiRequest('/api/copy/executions', {
			query: { status: args.status, limit: args.limit },
		});
		const rows = Array.isArray(data?.executions) ? data.executions : [];
		const executions = rows.map(shapeExecution);
		return {
			ok: true,
			status: args.status,
			count: executions.length,
			executions,
		};
	},
};
