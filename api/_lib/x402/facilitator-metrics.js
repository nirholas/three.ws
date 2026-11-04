// Public, read-only operating numbers for the self-hosted facilitator.
//
// Every verify/settle the facilitator handles is a row in
// x402_self_facilitator_log. This rolls the live window up and splits it by
// who paid: payers the platform controls (the closed-loop canary the ring
// economy runs against itself) versus every other payer. The split is
// published on purpose, so nobody reads canary volume as outside adoption.

const WINDOW_DAYS = 7;

/**
 * @param {Function} sql tagged-template query function
 * @param {Set<string>} internalWallets addresses the platform controls
 */
export async function facilitatorMetrics(sql, internalWallets) {
	const internal = Array.from(internalWallets);
	const rows = await sql`
		SELECT action,
		       ok,
		       CASE WHEN payer = ANY(${internal}::text[]) THEN 'internal_canary' ELSE 'external' END AS origin,
		       split_part(COALESCE(reject_reason, ''), ':', 1) AS reason,
		       count(*)::int AS n,
		       COALESCE(sum(fee_lamports), 0)::bigint AS fee_lamports
		FROM x402_self_facilitator_log
		WHERE ts >= now() - make_interval(days => ${WINDOW_DAYS})
		GROUP BY 1, 2, 3, 4`;

	const blank = () => ({ verifies: 0, settles: 0, settled: 0, pending: 0, refusals: {}, sponsorLamportsBurned: 0 });
	const out = { internal_canary: blank(), external: blank() };
	for (const r of rows) {
		const o = out[r.origin];
		if (r.action === 'verify') o.verifies += r.n;
		if (r.action === 'settle') {
			o.settles += r.n;
			if (r.ok) o.settled += r.n;
			else if (r.reason === 'settlement_pending') o.pending += r.n;
		}
		if (!r.ok && r.reason && r.reason !== 'settlement_pending') o.refusals[r.reason] = (o.refusals[r.reason] || 0) + r.n;
		o.sponsorLamportsBurned += Number(r.fee_lamports);
	}
	return { windowDays: WINDOW_DAYS, ...out };
}
