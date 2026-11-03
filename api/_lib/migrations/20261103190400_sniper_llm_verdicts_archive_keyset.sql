-- Keyset index for the db-retention archive-then-prune scan (api/_lib/db-archive.js):
-- pages read WHERE created_at < cutoff ORDER BY (created_at, mint, network, model), which without this index is a
-- full scan of the table per 2,500-row page. CONCURRENTLY so writers are never
-- blocked; it must be the only statement in the file (scripts/apply-migrations.mjs).
CREATE INDEX CONCURRENTLY IF NOT EXISTS sniper_llm_verdicts_archive_keyset ON sniper_llm_verdicts (created_at, mint, network, model);
