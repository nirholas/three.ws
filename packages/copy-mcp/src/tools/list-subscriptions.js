// `list_subscriptions` — the copier's own follow list. Read-only, account-scoped.
//
// Wraps GET /api/copy/subscriptions.

import { apiRequest } from '../lib/api.js';
import { shapeSubscription } from '../lib/shapes.js';

export const def = {
	name: 'list_subscriptions',
	title: 'List my copy-trade subscriptions',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'List the copy-trade subscriptions belonging to the authenticated account — every leader (a trader with a track record) you follow, with their identity, the subscription status (active / paused / stopped), the sizing rule and full guard-rule set, the performance fee, the high-water mark, and live pending/acted copy-intent counts. Use this to audit who you copy and how aggressively before tuning a follow with update_subscription. Returns the subscriptions newest-first. Read-only; requires THREE_WS_API_KEY.',
	inputSchema: {},
	async handler() {
		const data = await apiRequest('/api/copy/subscriptions');
		const rows = Array.isArray(data?.subscriptions) ? data.subscriptions : [];
		const subscriptions = rows.map(shapeSubscription);
		return {
			ok: true,
			count: subscriptions.length,
			active: subscriptions.filter((s) => s.status === 'active').length,
			paused: subscriptions.filter((s) => s.status === 'paused').length,
			subscriptions,
		};
	},
};
