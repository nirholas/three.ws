// `list_notifications` — read the agent's own notification inbox. Read-only.
//
// Wraps GET /api/notifications?limit=&type= → { notifications[], unread_count }.
// The inbox aggregates every inbound event for the account: pump/market alerts,
// sales & earnings, purchases, social mentions, IRL interactions, and account /
// security notices. Each row carries its delivered `payload` and a `read_at`
// timestamp (null ⇒ unread).

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'list_notifications',
	title: 'List notifications',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		"Read the authenticated agent's notification inbox — the inbound-event feed the platform delivers " +
		'to the account: market/pump alerts, sales & earnings, purchase receipts, social mentions, IRL ' +
		'interactions, and account/security notices. Returns the most recent notifications (newest first), ' +
		'each with its `id`, `type`, the event `payload`, a `read` boolean and `read_at` timestamp (null ⇒ ' +
		'unread), and `created_at`; plus `unread_count`, the total number of unread items in the inbox. Pass ' +
		'`type` to return only one notification type (e.g. "pump_alert", "skill_purchased", ' +
		'"security_alert"), and `limit` (1-50, default 20) to cap how many rows come back. Read-only. Use it ' +
		'to surface alerts without polling, then mark_read / delete_notification to manage them.',
	inputSchema: {
		type: z
			.string()
			.regex(/^[a-z0-9_]{1,40}$/, 'type must be a lower_snake_case notification type')
			.optional()
			.describe(
				'Optional filter: return only this notification type (e.g. "pump_alert", "skill_purchased", ' +
					'"referral_earned", "security_alert"). Lower_snake_case, ≤40 chars. Omit for all types.',
			),
		limit: z
			.number()
			.int()
			.min(1)
			.max(50)
			.optional()
			.describe('How many notifications to return, newest first. 1–50, default 20.'),
	},
	async handler(args) {
		const type = args?.type ? String(args.type).trim() : undefined;
		const limit = args?.limit !== undefined ? Math.min(50, Math.max(1, Math.trunc(args.limit))) : undefined;

		const data = await apiRequest('/api/notifications', { query: { type, limit } });
		const notifications = Array.isArray(data?.notifications) ? data.notifications : [];

		return {
			ok: true,
			...(type ? { type } : {}),
			unread_count: typeof data?.unread_count === 'number' ? data.unread_count : 0,
			count: notifications.length,
			notifications: notifications.map((n) => ({
				id: n.id,
				type: n.type,
				payload: n.payload ?? {},
				read: n.read_at != null,
				read_at: n.read_at ?? null,
				created_at: n.created_at,
			})),
		};
	},
};
