// `get_alert_history` — recent pump.fun alerts that actually fired for the
// authenticated account, with their delivery context. Read-only, account-scoped.
//
// Wraps GET /api/notifications?type=pump_alert. Every fired alert is persisted as
// a `pump_alert` notification whose payload IS the alert (kind, mint, amounts,
// market cap, tx, …). Optional client-side filters by rule_id / kind narrow the
// returned page; the API serves at most the 50 most recent pump alerts.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';
import { shapeAlert } from '../lib/shapes.js';

const API_MAX = 50;

export const def = {
	name: 'get_alert_history',
	title: 'Read fired pump.fun alert history',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Read the pump.fun alerts that have actually fired for the authenticated account, newest first. ' +
		'Each entry carries a one-line `summary`, the originating `rule_id`, the event `kind`, the coin ' +
		'(mint / name / symbol), whether it has been `read`, when it `fired_at`, and the full `event` ' +
		'payload (amounts, market cap, tx signature, buyer, …). Use this to review what fired; pair it with list_alert_rules, whose ' +
		'`recent_deliveries` shows per-channel send outcomes — to see both what fired and how it was ' +
		'delivered. Optionally filter to one rule (rule_id) or one kind. The feed returns at most the 50 ' +
		'most recent alerts. Requires THREE_WS_SESSION.',
	inputSchema: {
		limit: z
			.number()
			.int()
			.min(1)
			.max(API_MAX)
			.default(20)
			.describe('Maximum number of fired alerts to return, newest first (1–50, default 20).'),
		rule_id: z
			.string()
			.uuid()
			.optional()
			.describe('Only return alerts fired by this rule id (matches the rule_id in each alert payload).'),
		kind: z
			.enum(['graduation', 'price_above', 'price_below', 'whale_buy', 'new_mint'])
			.optional()
			.describe('Only return alerts of this event kind.'),
	},
	async handler(args) {
		const limit = args?.limit ?? 20;
		const filtering = Boolean(args?.rule_id || args?.kind);
		// When filtering client-side, pull the full page so the filter isn't applied
		// to a pre-truncated slice; otherwise ask only for what the caller wants.
		const data = await apiRequest('/api/notifications', {
			auth: true,
			query: { type: 'pump_alert', limit: filtering ? API_MAX : limit },
		});

		let alerts = Array.isArray(data?.notifications) ? data.notifications.map(shapeAlert).filter(Boolean) : [];
		if (args?.rule_id) alerts = alerts.filter((a) => a.rule_id === args.rule_id);
		if (args?.kind) alerts = alerts.filter((a) => a.kind === args.kind);
		alerts = alerts.slice(0, limit);

		return { ok: true, count: alerts.length, unread_count: data?.unread_count ?? 0, alerts };
	},
};
