-- HELD: not applied by db:migrate (the runner reads only top-level *.sql).
--
-- Drops the old-model vectors kept beside the new ones during the move to
-- nvidia/nemotron-3.5-embed-8b@2048 (api/_lib/migrations/20261116193000_embedding_migration_shadow.sql).
-- Promote it (git mv into api/_lib/migrations/ with a fresh timestamp, then
-- npm run db:migrate -- --file <name>) only after every table shows
-- "verified" in `npm run nvidia:reembed -- --status`. After this runs,
-- `npm run nvidia:reembed -- --restore` has nothing to restore from.
--
-- The embedding_migrations table stays: it is the record of the cutover.

ALTER TABLE agent_memories DROP COLUMN IF EXISTS embedding_prev;
ALTER TABLE agent_memories DROP COLUMN IF EXISTS embedder_prev;

ALTER TABLE agent_knowledge_chunks DROP COLUMN IF EXISTS embedding_prev;
ALTER TABLE agent_knowledge_chunks DROP COLUMN IF EXISTS embedder_prev;

ALTER TABLE widget_knowledge_chunks DROP COLUMN IF EXISTS embedding_prev;
ALTER TABLE widget_knowledge_chunks DROP COLUMN IF EXISTS embedder_prev;
