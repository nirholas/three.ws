-- Keyset index for the db-retention archive-then-prune scan (api/_lib/db-archive.js):
-- pages read WHERE first_seen_at < cutoff ORDER BY (first_seen_at, mint, network), which without this index is a
-- full scan of the table per 2,500-row page. CONCURRENTLY so writers are never
-- blocked; it must be the only statement in the file (scripts/apply-migrations.mjs).
CREATE INDEX CONCURRENTLY IF NOT EXISTS oracle_training_set_archive_keyset ON oracle_training_set (first_seen_at, mint, network);
