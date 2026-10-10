// `update_alert_rule` — change an existing pump.fun alert rule on the
// authenticated account. Write, idempotent: re-applying the same patch leaves the
// rule in the same state.
//
// Wraps PATCH /api/alerts/rules/:id. Only the fields you pass change; everything
// else is left as-is. Clearable fields (target_mint, target_agent, threshold,
// webhook_url, telegram_chat, label) accept null to remove the value. The merged
// rule is re-validated by the API against its (possibly new) kind.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';
import { shapeRule } from '../lib/shapes.js';

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const dropUndefined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

export const def = {
	name: 'update_alert_rule',
	title: 'Update a pump.fun alert rule',
	annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
	description:
		'Update an existing pump.fun alert rule by id on the authenticated three.ws account. Partial — only ' +
		'the fields you pass change. Idempotent: re-applying the same values yields the same rule. Common ' +
		'uses: flip `enabled` to pause/resume, retune `threshold`, add or swap a delivery channel, or ' +
		'change `kind` (the rule is re-validated against the new kind, and fields incompatible with it are ' +
		'cleared automatically). Pass null to clear a clearable field (target_mint, target_agent, ' +
		'threshold, webhook_url, telegram_chat, label). Removing webhook_url drops its secret; adding one ' +
		'mints a fresh webhook_secret (returned). The result must still have at least one delivery channel ' +
		'and satisfy the kind\'s targeting/threshold rules, or the API rejects it with a precise message. ' +
		'Returns the updated rule. Requires THREE_WS_SESSION. ' +
		'Use this to pause, retune, or re-route an existing rule; unlike delete_alert_rule it keeps the rule and its history.',
	inputSchema: {
		rule_id: z.string().uuid().describe('Id of the rule to update (from list_alert_rules).'),
		kind: z
			.enum(['graduation', 'price_above', 'price_below', 'whale_buy', 'new_mint'])
			.optional()
			.describe('Change the event kind. The rule is re-validated against it and incompatible fields are cleared.'),
		target_mint: z
			.string()
			.regex(BASE58_RE, 'must be a base58 Solana mint address')
			.nullable()
			.optional()
			.describe('Coin mint to watch, or null to clear. Required by price/whale kinds; forbidden for new_mint.'),
		target_agent: z
			.string()
			.uuid()
			.nullable()
			.optional()
			.describe('three.ws agent UUID to watch, or null to clear. Required by new_mint; forbidden for mint-targeted kinds.'),
		threshold: z
			.number()
			.positive()
			.nullable()
			.optional()
			.describe('USD market cap (price kinds) or SOL buy size (whale_buy), or null to clear.'),
		deliver_in_app: z.boolean().optional().describe('Toggle in-app delivery.'),
		webhook_url: z
			.string()
			.url()
			.refine((u) => /^https:\/\//i.test(u), 'must be https')
			.nullable()
			.optional()
			.describe('HTTPS endpoint for signed alert events, or null to remove the webhook (and its secret).'),
		telegram_chat: z
			.string()
			.regex(/^(-?\d{1,32}|@[a-zA-Z0-9_]{4,64})$/, 'numeric chat id or @username')
			.nullable()
			.optional()
			.describe('Telegram numeric chat id or @username, or null to remove.'),
		cooldown_seconds: z
			.number()
			.int()
			.min(5)
			.max(86_400)
			.optional()
			.describe('Minimum seconds between fires (5–86400).'),
		enabled: z.boolean().optional().describe('Enable or pause the rule.'),
		label: z.string().max(80).nullable().optional().describe('Human label, or null to fall back to the derived default.'),
	},
	async handler(args) {
		const { rule_id, ...rest } = args;
		const body = dropUndefined(rest);
		const data = await apiRequest(`/api/alerts/rules/${encodeURIComponent(rule_id)}`, {
			method: 'PATCH',
			auth: true,
			body,
		});
		return { ok: true, rule: shapeRule(data?.rule) };
	},
};
