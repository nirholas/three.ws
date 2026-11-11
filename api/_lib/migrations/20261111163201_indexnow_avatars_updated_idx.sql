-- The IndexNow reconciler (api/_lib/indexnow-queue.js) reads avatars changed
-- since its cursor, ordered by (updated_at, id), every ten minutes. Without
-- this index each run is a full scan of the 130k-row table. CONCURRENTLY so
-- writers are never blocked; it must be the only statement in the file
-- (scripts/apply-migrations.mjs).
CREATE INDEX CONCURRENTLY IF NOT EXISTS avatars_updated_at_id ON avatars (updated_at, id);
