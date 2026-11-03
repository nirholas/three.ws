// Lifetime reads of the self-hosted facilitator's settle book.
//
// x402_self_facilitator_log is archived to cold storage and pruned past a
// 60-day live window by api/cron/db-retention.js. The pruning statement adds
// the removed rows' totals to x402_self_facilitator_rollup in the SAME
// statement (api/_lib/db-archive-tables.js), so a row is counted exactly once,
// either live or in the rollup. Every unbounded read of the book goes through
// here so published lifetime figures survive pruning byte for byte.
//
// A bounded period (24h, 7d, 30d) is always inside the live window and reads
// the log alone.

/**
 * Settled count, gross (atomic) and fee (lamports) since `since`, or for all
 * time when `since` is null.
 *
 * @param {Function} sql tagged-template query function
 * @param {string|null} since ISO timestamp, or null for lifetime
 */
export async function settleTotals(sql, since) {
	const [row] = await sql`
		SELECT COALESCE(sum(n), 0)::bigint AS n,
		       COALESCE(sum(gross), 0)::bigint AS gross,
		       COALESCE(sum(fee), 0)::bigint AS fee
		FROM (
			SELECT count(*) AS n, COALESCE(sum(amount_atomic), 0) AS gross, COALESCE(sum(fee_lamports), 0) AS fee
			FROM x402_self_facilitator_log
			WHERE action = 'settle' AND ok = true
			  AND (${since}::timestamptz IS NULL OR ts >= ${since}::timestamptz)
			UNION ALL
			SELECT COALESCE(sum(n), 0), COALESCE(sum(amount_atomic), 0), COALESCE(sum(fee_lamports), 0)
			FROM x402_self_facilitator_rollup
			WHERE action = 'settle' AND ok = true AND ${since}::timestamptz IS NULL
		) u
	`;
	return { n: Number(row.n), gross: row.gross, fee: row.fee };
}

/**
 * Settled count and `mint` volume per UTC day, all history (live rows plus the
 * rollup of pruned days).
 *
 * @param {Function} sql tagged-template query function
 * @param {string} mint the mint whose atomic volume is summed
 */
export async function settleDaily(sql, mint) {
	return sql`
		SELECT day, sum(settlements)::bigint AS settlements, sum(usdc_atomic)::text AS usdc_atomic
		FROM (
			SELECT to_char((ts AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day,
			       COUNT(*)::bigint AS settlements,
			       COALESCE(SUM(amount_atomic) FILTER (WHERE mint = ${mint}), 0) AS usdc_atomic
			FROM x402_self_facilitator_log
			WHERE action = 'settle' AND ok = true
			GROUP BY 1
			UNION ALL
			SELECT to_char(day, 'YYYY-MM-DD'), sum(n)::bigint,
			       COALESCE(sum(amount_atomic) FILTER (WHERE mint = ${mint}), 0)
			FROM x402_self_facilitator_rollup
			WHERE action = 'settle' AND ok = true
			GROUP BY 1
		) u
		GROUP BY 1
		ORDER BY 1
	`;
}
