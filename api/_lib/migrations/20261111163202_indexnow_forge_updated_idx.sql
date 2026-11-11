-- The IndexNow reconciler (api/_lib/indexnow-queue.js) reads forge creations
-- changed since its cursor, ordered by (updated_at, id), every ten minutes.
-- Without this index each run is a full scan of the table. CONCURRENTLY so
-- writers are never blocked; it must be the only statement in the file
-- (scripts/apply-migrations.mjs).
CREATE INDEX CONCURRENTLY IF NOT EXISTS forge_creations_updated_at_id ON forge_creations (updated_at, id);
