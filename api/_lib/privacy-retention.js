// Deletion windows promised by the privacy policy (public/legal/privacy.html,
// section 5) for tables no other job prunes. Called from api/cron/db-retention.js
// every tick; each table is deleted in bounded batches so a backlog drains over
// a few ticks instead of holding one long transaction.
//
// These rows are deleted outright, never archived: an archive would keep the
// data the policy says is gone. Every table name, column and predicate is a
// fixed constant; only the window (hours) and the batch size are parameters.
//
// Other section 5 windows live elsewhere and are not repeated here:
//   accounts (30-day soft delete)  api/cron/purge-deleted-accounts.js
//   usage_events                   api/_lib/db-archive-tables.js (archive, then prune)
//   audit_log, x402_audit_log      api/cron/[name].js audit-log-cleanup
//   home_action_log                api/_lib/home/privacy.js
//   siwx_nonces, csrf_tokens       api/cron/[name].js siwx-gc, cleanup-csrf-tokens

const NONCE_PROMISE = 'Nonces expire after 5 minutes and are purged within 24 hours.';

export const PRIVACY_RETENTION = [
	{
		table: 'sessions',
		hours: 24 * 30,
		// A row holds the sign-in IP and user agent. It is useless once expired or
		// revoked; keep 30 days past that for "where was I signed in" support.
		predicate: `(expires_at < now() - $1 * interval '1 hour' OR revoked_at < now() - $1 * interval '1 hour')`,
		promise: 'Session tokens expire after 30 days.',
	},
	{ table: 'siwe_nonces', hours: 24, predicate: `expires_at < now() - $1 * interval '1 hour'`, promise: NONCE_PROMISE },
	{ table: 'siws_nonces', hours: 24, predicate: `expires_at < now() - $1 * interval '1 hour'`, promise: NONCE_PROMISE },
	{ table: 'gate_nonces', hours: 24, predicate: `expires_at < now() - $1 * interval '1 hour'`, promise: NONCE_PROMISE },
	{ table: 'embed_gate_nonces', hours: 24, predicate: `expires_at < now() - $1 * interval '1 hour'`, promise: NONCE_PROMISE },
	{
		table: 'widget_views',
		hours: 24 * 365,
		predicate: `created_at < now() - $1 * interval '1 hour'`,
		promise: 'Widget view events (no personal data) are retained for 12 months.',
	},
];

/**
 * Enforce every PRIVACY_RETENTION window once.
 *
 * @param {object} deps
 * @param {(text: string, params: unknown[]) => Promise<unknown[]>} deps.sql  parameterised query
 * @param {(table: string) => Promise<boolean>} deps.tableExists
 * @param {number} [deps.batch] rows per DELETE
 * @param {number} [deps.maxBatches] DELETEs per table per call
 * @returns {Promise<{deleted: Record<string, number>, skipped: string[], errors?: Record<string, string>}>}
 */
export async function purgePrivacyRetention({ sql, tableExists, batch = 5000, maxBatches = 10 }) {
	const deleted = {};
	const skipped = [];
	const errors = {};
	for (const { table, hours, predicate } of PRIVACY_RETENTION) {
		if (!(await tableExists(table))) {
			skipped.push(table);
			continue;
		}
		let n = 0;
		try {
			for (let i = 0; i < maxBatches; i++) {
				const rows = await sql(
					`DELETE FROM ${table} WHERE ctid IN (
					SELECT ctid FROM ${table} WHERE ${predicate} LIMIT $2
				) RETURNING 1`,
					[hours, batch],
				);
				n += rows.length;
				if (rows.length < batch) break;
			}
		} catch (err) {
			errors[table] = String(err?.message || err).slice(0, 160);
		}
		if (n > 0) deleted[table] = n;
	}
	return Object.keys(errors).length ? { deleted, skipped, errors } : { deleted, skipped };
}
