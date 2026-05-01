// Audit log helper — fire-and-forget INSERT into audit_log.
//
// Policy: log sensitive state changes that need an after-the-fact "who did
// what, when" trail (deletions, revocations, ownership transfers). Reads,
// idempotent updates, and analytics belong in usage_events, not here.
//
// Schema: api/_lib/migrations/2026-05-01-audit-log.sql
// Audit data starts 2026-05-01 — earlier deletions/revocations have no row.

import { sql } from './db.js';

/**
 * Fire-and-forget audit log write. Never throws, never blocks the response.
 * @param {object} entry
 * @param {string|null} entry.userId      — actor (null only when actor is unknown / system)
 * @param {string} entry.action           — short kebab-case verb, e.g. 'delete_avatar'
 * @param {string|null} [entry.resourceId]
 * @param {object|null} [entry.meta]      — small JSON blob; avoid PII
 */
export function logAudit({ userId, action, resourceId = null, meta = null }) {
	queueMicrotask(async () => {
		try {
			await sql`
				insert into audit_log (user_id, action, resource_id, meta)
				values (${userId}, ${action}, ${resourceId}, ${meta})
			`;
		} catch (err) {
			console.error('[audit] insert failed', { action, resourceId, error: err?.message });
		}
	});
}
