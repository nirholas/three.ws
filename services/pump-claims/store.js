/**
 * pump_fee_claims persistence. Runs outside api/, so it owns its own Neon
 * client rather than importing api/_lib/db.js (mirrors workers/agora-citizens's
 * store.js). `makeStore` accepts either a DATABASE_URL string (production) or
 * an already-built sql tagged-template function (tests), so the insert path
 * is exercised without a live database.
 */

import { neon } from '@neondatabase/serverless';

/**
 * @param {string|Function} databaseUrlOrSql
 */
export function makeStore(databaseUrlOrSql) {
	const sql = typeof databaseUrlOrSql === 'string' ? neon(databaseUrlOrSql) : databaseUrlOrSql;

	return {
		/**
		 * Build the DB row for one attributed claim (pipeline.js's output). `slot`
		 * comes from the caller: the live listener's onLogs context carries it,
		 * attributeGithubClaim's return value does not.
		 * @param {object} claim
		 * @param {{slot?: number|null}} [opts]
		 */
		toRow(claim, { slot = null } = {}) {
			return {
				signature: claim.signature,
				mint: claim.mint || null,
				claimer: claim.creator,
				githubUserId: claim.githubUserId != null ? String(claim.githubUserId) : null,
				lamports: String(claim.lamports || 0),
				label: claim.attribution?.label || null,
				held: Boolean(claim.held),
				slot,
				ts: claim.ts || Math.floor(Date.now() / 1000),
			};
		},

		/**
		 * Idempotent insert keyed on signature.
		 * @returns {Promise<boolean>} true the first time this signature is stored.
		 */
		async insertClaim(row) {
			const rows = await sql`
				insert into pump_fee_claims (
					signature, mint, claimer, github_user_id, lamports, label, held, slot, created_at
				) values (
					${row.signature}, ${row.mint}, ${row.claimer}, ${row.githubUserId},
					${row.lamports}, ${row.label}, ${row.held}, ${row.slot}, to_timestamp(${row.ts})
				)
				on conflict (signature) do nothing
				returning signature
			`;
			return rows.length > 0;
		},

		/** Row count since `sinceTs` (unix seconds), for the 10-minute verification run. */
		async countSince(sinceTs) {
			const rows = await sql`
				select count(*)::int as n from pump_fee_claims where created_at >= to_timestamp(${sinceTs})
			`;
			return rows[0]?.n ?? 0;
		},
	};
}
