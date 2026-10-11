// `list_payment_sessions` — list your payment sessions and aggregate stats.

import { z } from 'zod';
import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'list_payment_sessions',
	title: 'List payment sessions and spending stats',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
	description:
		'List your payment sessions with aggregate spending stats. Filter by status. ' +
		'Stats include: total budget allocated, total spent, active/exhausted/expired counts, ' +
		'settled payment count, and unique endpoints paid. Requires THREE_WS_SESSION. ' +
		'Use this to audit all your sessions and total spend; for one session\'s detail and executions call check_payment_session.',
	inputSchema: {
		status: z.enum(['active', 'exhausted', 'expired', 'cancelled']).optional()
			.describe('Filter by session status. Omit to return all sessions.'),
		limit: z.number().int().min(1).max(100).default(20)
			.describe('Number of sessions to return (max 100).'),
	},
	async handler(args) {
		const data = await apiRequest('/api/pay/session', {
			auth: true,
			query: {
				...(args.status ? { status: args.status } : {}),
				limit: String(args.limit ?? 20),
			},
		});

		return {
			ok: true,
			sessions: data.items,
			stats: data.stats,
			has_more: !!data.next_cursor,
		};
	},
};
