-- Totals of x402_self_facilitator_log rows that db-retention has archived to
-- cold storage and pruned. /api/x402-ring lifetime and the platform analytics
-- x402 source read this plus the live rows, so published lifetime figures do
-- not shrink when the log is pruned. The prune statement fills it in the same
-- statement that deletes the rows (api/_lib/db-archive-tables.js), so a row is
-- counted in exactly one of the two places.
CREATE TABLE IF NOT EXISTS x402_self_facilitator_rollup (
	day            date    NOT NULL,
	network        text    NOT NULL DEFAULT '',
	action         text    NOT NULL,
	ok             boolean NOT NULL,
	mint           text    NOT NULL DEFAULT '',
	reject_class   text    NOT NULL DEFAULT '',
	n              bigint  NOT NULL DEFAULT 0,
	amount_atomic  numeric NOT NULL DEFAULT 0,
	fee_lamports   numeric NOT NULL DEFAULT 0,
	PRIMARY KEY (day, network, action, ok, mint, reject_class)
);
