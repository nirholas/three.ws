-- spec: permissions/0.1  task: 19-indexer-cron
-- indexer_state — cursor table for the delegation event indexer cron.
-- Keyed by (contract, chain_id). last_indexed_block advances after each
-- successfully processed batch so a timeout preserves partial progress.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS indexer_state (
    id                  SERIAL PRIMARY KEY,
    contract            TEXT NOT NULL,
    chain_id            INTEGER NOT NULL,
    last_indexed_block  BIGINT NOT NULL DEFAULT 0,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (contract, chain_id)
);
