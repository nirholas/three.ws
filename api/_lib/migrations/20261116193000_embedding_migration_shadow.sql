-- Embedding model migration: shadow columns and a resumable cursor.
--
-- New embeddings move from nvidia/nemotron-3-embed-1b@2048 to
-- nvidia/nemotron-3.5-embed-8b@2048 (docs/nvidia/evals/embeddings-2026-11-16.md).
-- scripts/nvidia-reembed.mjs rewrites stored vectors into the new space. Each
-- rewrite is one UPDATE that copies the row's current vector and tag into the
-- *_prev columns and writes the new vector and tag into the live columns, so:
--   * reads never change: every row carries the tag of its live vector, and
--     query code embeds the query with that row's own model;
--   * a table mid-migration serves new vectors where present and old ones
--     elsewhere, with no retrieval gap;
--   * the old vectors stay until an eval on production data verifies the
--     cutover (npm run nvidia:reembed -- --verify), and the run can be rolled
--     back with --restore.
-- The prev columns are dropped later by a separate migration held in
-- api/_lib/migrations/held/ until the owner promotes it.

ALTER TABLE agent_memories ADD COLUMN IF NOT EXISTS embedding_prev jsonb;
ALTER TABLE agent_memories ADD COLUMN IF NOT EXISTS embedder_prev text;

ALTER TABLE agent_knowledge_chunks ADD COLUMN IF NOT EXISTS embedding_prev vector;
ALTER TABLE agent_knowledge_chunks ADD COLUMN IF NOT EXISTS embedder_prev text;

ALTER TABLE widget_knowledge_chunks ADD COLUMN IF NOT EXISTS embedding_prev jsonb;
ALTER TABLE widget_knowledge_chunks ADD COLUMN IF NOT EXISTS embedder_prev text;

-- One row per (table, target space): where the scan has reached and what it did.
CREATE TABLE IF NOT EXISTS embedding_migrations (
	table_name    text NOT NULL,
	target        text NOT NULL,
	cursor        text,
	scanned       integer NOT NULL DEFAULT 0,
	moved         integer NOT NULL DEFAULT 0,
	backfilled    integer NOT NULL DEFAULT 0,
	kept          integer NOT NULL DEFAULT 0,
	skipped       integer NOT NULL DEFAULT 0,
	started_at    timestamptz NOT NULL DEFAULT now(),
	updated_at    timestamptz NOT NULL DEFAULT now(),
	completed_at  timestamptz,
	verified_at   timestamptz,
	verification  jsonb,
	PRIMARY KEY (table_name, target)
);
