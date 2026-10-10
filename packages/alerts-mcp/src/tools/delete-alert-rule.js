// `delete_alert_rule` — permanently remove a pump.fun alert rule from the
// authenticated account. Write, DESTRUCTIVE: the rule and its fire/delivery
// history are deleted (cascade) and cannot be recovered.
//
// Wraps DELETE /api/alerts/rules/:id.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'delete_alert_rule',
	title: 'Delete a pump.fun alert rule',
	annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true, openWorldHint: true },
	description:
		'Permanently delete a pump.fun alert rule by id from the authenticated three.ws account. ' +
		'DESTRUCTIVE and irreversible: the rule plus its cooldown tracker and per-channel delivery log are ' +
		'removed (cascade). The rule stops firing immediately. Deleting an already-deleted id returns ' +
		'not_found (so this is not idempotent). Use this when a rule is no longer wanted at all; to pause it without losing it, prefer ' +
		'update_alert_rule with enabled:false. Returns the deleted rule id. Requires THREE_WS_SESSION.',
	inputSchema: {
		rule_id: z.string().uuid().describe('Id of the rule to delete (from list_alert_rules). This cannot be undone.'),
	},
	async handler(args) {
		const data = await apiRequest(`/api/alerts/rules/${encodeURIComponent(args.rule_id)}`, {
			method: 'DELETE',
			auth: true,
		});
		return { ok: true, deleted: true, id: data?.id ?? args.rule_id };
	},
};
