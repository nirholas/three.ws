// `delete_notification` — permanently remove one notification. Write, destructive.
//
// Wraps DELETE /api/notifications/:id → { ok, id, deleted }. Unlike mark_read
// (which only sets read_at), this removes the row from the inbox for good. The
// delete is account-scoped server-side — only the caller's own notification can
// be removed — and is irreversible, so it is annotated destructive.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'delete_notification',
	title: 'Delete notification',
	annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
	description:
		'Permanently delete a single notification from the inbox by its `id` (from list_notifications). ' +
		'Unlike mark_read, which only marks it read, this REMOVES the notification for good — the action is ' +
		'irreversible. Only a notification the caller owns can be deleted. Returns ' +
		'`{ ok: true, id, deleted: true }` on success, or a not_found error if the id does not exist for ' +
		'this account (e.g. it was already deleted). Use this to discard a notification entirely; prefer ' +
		'mark_read for normal triage.',
	inputSchema: {
		id: z.string().uuid().describe('UUID of the notification to permanently delete (from list_notifications).'),
	},
	async handler(args) {
		const id = String(args?.id ?? '').trim();
		if (!id) {
			throw Object.assign(new Error('A notification `id` is required.'), {
				code: 'validation_error',
				status: 400,
			});
		}
		const data = await apiRequest(`/api/notifications/${encodeURIComponent(id)}`, { method: 'DELETE' });
		return { ok: data?.ok !== false, id: data?.id ?? id, deleted: data?.deleted !== false };
	},
};
