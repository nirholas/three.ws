// `list_alert_rules` — the authenticated account's pump.fun alert rules.
// Read-only, account-scoped.
//
// Wraps GET /api/alerts/rules.

import { apiRequest } from '../lib/api.js';
import { shapeRule } from '../lib/shapes.js';

export const def = {
	name: 'list_alert_rules',
	title: 'List my pump.fun alert rules',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'List every pump.fun alert rule on the authenticated three.ws account. Each rule has a `kind` ' +
		'(graduation | price_above | price_below | whale_buy | new_mint), its target (target_mint or ' +
		'target_agent), an optional numeric `threshold` (USD market cap for price rules, SOL for whale_buy), ' +
		'the delivery channels (deliver_in_app, webhook_url + webhook_secret, telegram_chat), the cooldown, ' +
		'and whether it is enabled. Also returns live delivery health: `last_fired_at`, `recent_failures` ' +
		'(failed channel deliveries in the last 24h), and `recent_deliveries` (the last few per-channel ' +
		'outcomes). Use this to audit what an agent is watching before creating or editing rules. ' +
		'Requires THREE_WS_SESSION.',
	inputSchema: {},
	async handler() {
		const data = await apiRequest('/api/alerts/rules', { auth: true });
		const rules = Array.isArray(data?.rules) ? data.rules.map(shapeRule).filter(Boolean) : [];
		return { ok: true, count: rules.length, rules };
	},
};
