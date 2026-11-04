-- x402 payment audit ledger durability (additive, idempotent).
--
--   1. x402_audit_dead_letter: where an audit row goes when it cannot be
--      inserted (parked after exhausting retries, or when neither Redis nor the
--      database would take it), so a payment record is never silently dropped.
--      Also the recoverable copy of any duplicate row removed in step 2.
--   2. Duplicate (tx_hash, event_type) rows already in x402_audit_log are copied
--      into the dead-letter table (reason 'dedupe', already resolved) and then
--      removed, keeping the earliest row per key. Nothing is lost: every removed
--      row is stored whole as jsonb.
--   3. Partial UNIQUE index on (tx_hash, event_type) where tx_hash is not null,
--      so a retry or replay can never double-write a transaction and the table
--      can be reconciled against the chain one to one.

CREATE TABLE IF NOT EXISTS x402_audit_dead_letter (
  id BIGSERIAL PRIMARY KEY,
  payload JSONB NOT NULL,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  first_failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason TEXT NOT NULL DEFAULT 'insert_failed',
  resolved_at TIMESTAMPTZ
);

-- The table may already exist from the first manual dedupe pass (same shape
-- minus resolved_at). Bring it up to this definition and mark its dedupe copies
-- resolved so they never count toward the dead-letter depth.
ALTER TABLE x402_audit_dead_letter ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
UPDATE x402_audit_dead_letter SET resolved_at = COALESCE(last_failed_at, NOW())
  WHERE reason = 'dedupe' AND resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_x402_audit_dead_letter_open
  ON x402_audit_dead_letter (first_failed_at) WHERE resolved_at IS NULL;

WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY tx_hash, event_type ORDER BY created_at NULLS LAST, id) AS rn
  FROM x402_audit_log
  WHERE tx_hash IS NOT NULL
)
INSERT INTO x402_audit_dead_letter (payload, error, attempts, first_failed_at, last_failed_at, reason, resolved_at)
SELECT to_jsonb(l), 'duplicate (tx_hash, event_type) removed by migration 20261104000000', 0,
       COALESCE(l.created_at, NOW()), NOW(), 'dedupe', NOW()
FROM x402_audit_log l
JOIN ranked r ON r.id = l.id
WHERE r.rn > 1;

WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY tx_hash, event_type ORDER BY created_at NULLS LAST, id) AS rn
  FROM x402_audit_log
  WHERE tx_hash IS NOT NULL
)
DELETE FROM x402_audit_log l
USING ranked r
WHERE r.id = l.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS ux_x402_audit_tx_event
  ON x402_audit_log (tx_hash, event_type) WHERE tx_hash IS NOT NULL;
