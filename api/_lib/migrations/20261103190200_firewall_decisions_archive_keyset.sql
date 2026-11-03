-- Keyset index for the db-retention archive-then-prune scan (api/_lib/db-archive.js):
-- pages read WHERE created_at < cutoff ORDER BY (created_at, id), which without this index is a
-- full scan of the table per 2,500-row page. CONCURRENTLY so writers are never
-- blocked; it must be the only statement in the file (scripts/apply-migrations.mjs).
CREATE INDEX CONCURRENTLY IF NOT EXISTS firewall_decisions_archive_keyset ON firewall_decisions (created_at, id);
