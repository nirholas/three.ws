-- Keyset index for the db-retention archive-then-prune scan (api/_lib/db-archive.js):
-- pages read WHERE occurred_at < cutoff ORDER BY (occurred_at, id), which without this index is a
-- full scan of the table per 2,500-row page. CONCURRENTLY so writers are never
-- blocked; it must be the only statement in the file (scripts/apply-migrations.mjs).
CREATE INDEX CONCURRENTLY IF NOT EXISTS agent_onchain_events_archive_keyset ON agent_onchain_events (occurred_at, id);
