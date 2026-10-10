// `cancel_subscription` — stop following a leader. Write, destructive.
//
// Wraps DELETE /api/copy/subscriptions?id=<id>. This is a SOFT stop: the
// subscription transitions to status="stopped" and stops generating any new copy
// intents, but its history (past executions, earnings) is preserved. To follow
// the same leader again later, call create_subscription (it re-activates the row).

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'cancel_subscription',
	title: 'Stop a copy-trade subscription',
	annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: true, openWorldHint: true },
	description:
		'Stop following a leader: transitions the subscription to "stopped" so no new copy intents are generated. DESTRUCTIVE in that it ends an active money-adjacent follow, but it is a SOFT stop: execution history and earnings are preserved, and you can re-follow the same leader later with create_subscription. Use this when the follow should end; to merely halt copies temporarily without ending it, call update_subscription with status:"paused" instead. Returns the cancellation result. Requires THREE_WS_API_KEY.',
	inputSchema: {
		id: z.string().uuid().describe('UUID of the subscription to stop (from list_subscriptions).'),
	},
	async handler(args) {
		const data = await apiRequest('/api/copy/subscriptions', {
			method: 'DELETE',
			query: { id: args.id },
		});
		return { ok: data?.ok ?? true, id: data?.id ?? args.id, status: data?.status ?? 'stopped' };
	},
};
