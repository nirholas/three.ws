// `mark_read` — mark notifications read. Write, idempotent, non-destructive.
//
// Wraps two real endpoints:
//   • POST /api/notifications/:id/read  → mark one notification read
//   • POST /api/notifications/read-all  → mark every unread notification read
// Marking read only sets `read_at` (coalesced server-side), so re-running with
// the same args is a no-op — idempotent. It removes nothing.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'mark_read',
	title: 'Mark notifications read',
	annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
	description:
		'Mark notifications as read in the inbox. Pass `id` to mark a single notification read, or `all: ' +
		'true` to mark every unread notification read at once (exactly one of the two is required). Marking ' +
		'read only updates the read timestamp — it does not delete anything, and re-running with the same ' +
		'arguments has no further effect (idempotent). When `id` is given, returns the notification id and ' +
		'its `read_at`; when `all` is given, returns `marked_read`, the number of notifications newly marked ' +
		'read. Use this for normal triage after list_notifications; to remove a notification entirely use ' +
		'delete_notification instead.',
	inputSchema: {
		id: z
			.string()
			.uuid()
			.optional()
			.describe('UUID of a single notification to mark read (from list_notifications). Mutually exclusive with `all`.'),
		all: z
			.boolean()
			.optional()
			.describe('When true, mark every unread notification in the inbox read. Mutually exclusive with `id`.'),
	},
	async handler(args) {
		const id = args?.id ? String(args.id).trim() : '';
		const all = args?.all === true;

		if (all && id) {
			throw Object.assign(new Error('Pass either `id` (one notification) or `all: true` — not both.'), {
				code: 'validation_error',
				status: 400,
			});
		}

		if (all) {
			const data = await apiRequest('/api/notifications/read-all', { method: 'POST' });
			return { ok: true, scope: 'all', marked_read: typeof data?.marked_read === 'number' ? data.marked_read : 0 };
		}

		if (!id) {
			throw Object.assign(
				new Error('Provide `id` to mark one notification read, or `all: true` to mark every unread one read.'),
				{ code: 'validation_error', status: 400 },
			);
		}

		const data = await apiRequest(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
		return { ok: true, scope: 'one', id: data?.id ?? id, read_at: data?.read_at ?? null };
	},
};
