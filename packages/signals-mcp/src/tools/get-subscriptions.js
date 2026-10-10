// `get_subscriptions` — the caller's signal subscriptions with delivery history
// and realized performance. Account-scoped, read-only.
//
// Wraps GET /api/signals/subscribe (Authorization: Bearer <THREE_WS_API_KEY>).

import { apiRequest, requireApiKey } from '../lib/api.js';

export const def = {
	name: 'get_subscriptions',
	title: 'List your signal subscriptions + delivery history',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		"List every signal subscription owned by the authenticated account — the follower's tracking surface. " +
		'Each subscription returns its numeric `id` (pass this to set_subscription_status), the subscriber agent, ' +
		'the feed it follows (slug, title, publisher, pricing), the copy-trade config (mode simulate/live, billing, ' +
		'base_sol, size_scaling, max_per_trade_sol, slippage_bps, firewall_level, copy_exits), live status ' +
		'(status, killed flag, epoch_paid_until, last delivered emission), and the realized delivery stats: ' +
		'`stats.executed` (mirror fills that executed on-chain), `stats.paid_count` (paid deliveries), and ' +
		'`stats.usdc_spent` (total USDC paid to the publisher). Use this to check what you follow and what it has ' +
		'cost before changing a subscription with set_subscription_status. Requires THREE_WS_API_KEY. Read-only live data.',
	inputSchema: {},
	async handler() {
		requireApiKey();
		const data = await apiRequest('/api/signals/subscribe', { method: 'GET' });
		const subscriptions = Array.isArray(data?.subscriptions) ? data.subscriptions : [];
		return {
			ok: true,
			count: subscriptions.length,
			subscriptions,
		};
	},
};
