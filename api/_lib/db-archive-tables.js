// The tables db-retention archives to cold storage and then prunes, with the
// readers audited for each window (order 249, 2026-11-03).
//
// Every name, column and predicate here is a fixed constant, never user input.
// `where` is applied to BOTH the archive select and the delete, so a row that
// stopped qualifying after it was archived (an alert acknowledged late, a tip
// swept) is never deleted.
//
// NOT archived, on purpose:
//   club_tips  its rows feed the all-time dancer leaderboard
//              (api/club/leaderboard.js, no time filter) and the cover-pass
//              distinct-wallet counts, and unswept rows (paid_at IS NULL) are
//              owed money (api/_lib/club/sweep.js). Pruning it needs a rollup
//              first, like x402_self_facilitator_log got.

export const ARCHIVED_TABLES = [
	{
		table: 'agent_onchain_events',
		tsColumn: 'occurred_at',
		pk: [{ col: 'id', type: 'bigint' }],
		days: 30,
		readers:
			'api/agents/onchain-history.js and api/_lib/onchain-events.js read the newest N events per agent_ref with no time bound; the chain is the source of truth, so history older than the window is re-derivable by the indexer.',
	},
	{
		table: 'oracle_training_set',
		tsColumn: 'first_seen_at',
		pk: [
			{ col: 'mint', type: 'text' },
			{ col: 'network', type: 'text' },
		],
		days: 45,
		where: `outcome <> 'unknown'`,
		readers:
			'api/cron/oracle-refit.js and scripts/oracle-fit.mjs read the oldest 400000 label_version>=2 rows (MAX_ROWS); the 45-day window still holds ~850k labeled rows, so the fit stays full. rug-softener reads one mint at a time for recent positions. Unlabeled rows are never pruned.',
	},
	{
		table: 'x402_self_facilitator_log',
		tsColumn: 'ts',
		pk: [{ col: 'id', type: 'uuid' }],
		days: 60,
		readers:
			'api/x402-ring.js lifetime and api/_lib/platform-analytics.js x402Source read all history: both now add x402_self_facilitator_rollup, which the delete below fills atomically in the same statement. api/_lib/x402/settle-credit.js priorCredit looks up one tx_sig (settle txs are blockhash-bound, so a signature older than the window cannot be replayed; x402_spent_payments keeps 90 days). Every other reader is 72h or shorter.',
		rollup: `INSERT INTO x402_self_facilitator_rollup
			(day, network, action, ok, mint, reject_class, n, amount_atomic, fee_lamports)
			SELECT (ts AT TIME ZONE 'UTC')::date, COALESCE(network, ''), action, ok, COALESCE(mint, ''),
			       split_part(COALESCE(reject_reason, ''), ':', 1),
			       count(*), COALESCE(sum(amount_atomic), 0), COALESCE(sum(fee_lamports), 0)
			FROM d GROUP BY 1, 2, 3, 4, 5, 6
			ON CONFLICT (day, network, action, ok, mint, reject_class) DO UPDATE SET
			  n = x402_self_facilitator_rollup.n + EXCLUDED.n,
			  amount_atomic = x402_self_facilitator_rollup.amount_atomic + EXCLUDED.amount_atomic,
			  fee_lamports = x402_self_facilitator_rollup.fee_lamports + EXCLUDED.fee_lamports`,
	},
	{
		table: 'firewall_decisions',
		tsColumn: 'created_at',
		pk: [{ col: 'id', type: 'bigint' }],
		days: 45,
		readers:
			'api/_lib/trade-receipt.js reads the decision nearest a position open time; api/_lib/strategy-preview.js and api/pump/safety.js read the latest decision per mint. A receipt for a position opened more than 45 days ago loses its firewall section; the archive holds it.',
	},
	{
		table: 'usage_events',
		tsColumn: 'created_at',
		pk: [{ col: 'id', type: 'bigint' }],
		days: 60,
		where: `kind <> 'metered'`,
		readers:
			"api/billing/invoices.js and api/_lib/metering.js rollupInvoice bill any past calendar month from kind='metered' rows, so metered rows are never pruned. Every other reader (billing/summary 24h and month, spend/me, trending) looks back 30 days or less.",
	},
	{
		table: 'sniper_llm_verdicts',
		tsColumn: 'created_at',
		pk: [
			{ col: 'mint', type: 'text' },
			{ col: 'network', type: 'text' },
			{ col: 'model', type: 'text' },
		],
		days: 30,
		readers:
			'api/sniper/experiments.js reads 24h and a bounded interval; trade-receipt.js reads the verdict for one position at a time (a receipt older than 30 days loses its judge section; the archive holds it).',
	},
	{
		table: 'ops_alerts',
		tsColumn: 'last_seen',
		pk: [{ col: 'signature', type: 'text' }],
		days: 30,
		where: `(acknowledged_at IS NOT NULL OR "count" <= 1)`,
		readers:
			'api/_lib/alerts.js dedups by signature within hours; healthz and subsystem-health look back 90 minutes. Unacknowledged recurring rows (count > 1) are kept.',
	},
];

export const archivedTableNames = () => ARCHIVED_TABLES.map((t) => t.table);
