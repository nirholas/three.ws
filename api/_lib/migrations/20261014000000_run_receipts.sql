-- Run receipts: one signed record per Studio generation, stating what each stage
-- was expected to do, what it actually did, and a verdict.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261014000000_run_receipts.sql
-- Idempotent and additive. Writers: api/_lib/run-receipt-store.js. Docs: docs/run-receipts.md.

CREATE TABLE IF NOT EXISTS run_receipts (
	id          text PRIMARY KEY,
	tool        text NOT NULL,
	outcome     text NOT NULL,
	-- sha256 prefix of the job handle, so check_job can complete a pending
	-- receipt without the handle itself ever being stored.
	job_ref     text,
	body        jsonb NOT NULL,
	sha256      text NOT NULL,
	signature   text,
	signer      text,
	created_at  timestamptz NOT NULL DEFAULT now(),
	updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS run_receipts_created_idx ON run_receipts (created_at DESC);
CREATE INDEX IF NOT EXISTS run_receipts_job_ref_idx ON run_receipts (job_ref) WHERE job_ref IS NOT NULL;
