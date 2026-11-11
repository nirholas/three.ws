-- Florence-2 descriptions for forge creations (microsoft order 819).
--
-- One row per creation: a short caption, a detailed caption, normalized tags
-- and detected objects, produced by Microsoft Florence-2 (MIT) on the
-- creation's poster image (workers/model-florence2). A side table rather than
-- columns on forge_creations: the hot table stays narrow, and the row doubles
-- as the describe queue (status 'queued' until the cron describes it).
--
--   status          queued | done | failed | skipped
--   tags            the live tag set: generated tags, minus any the owner
--                   removed, plus any the owner added (what search and the page use)
--   generated_tags  exactly what the model produced, kept for audit and so an
--                   owner edit never loses the original
--   tags_edited_at  set once the owner edits; a re-describe then leaves tags alone
--
-- The creation is never blocked on any of this: materializeCreation queues a
-- row fire-and-forget, and a missing row just means "not described yet".

CREATE TABLE IF NOT EXISTS forge_creation_descriptions (
	creation_id       uuid PRIMARY KEY REFERENCES forge_creations(id) ON DELETE CASCADE,
	status            text NOT NULL DEFAULT 'queued'
	                  CHECK (status IN ('queued', 'done', 'failed', 'skipped')),
	caption           text,
	detailed          text,
	tags              text[] NOT NULL DEFAULT '{}',
	generated_tags    text[] NOT NULL DEFAULT '{}',
	objects           jsonb,
	source_image_url  text,
	model             text,
	model_version     text,
	latency_ms        integer,
	attempts          integer NOT NULL DEFAULT 0,
	error             text,
	tags_edited_at    timestamptz,
	described_at      timestamptz,
	created_at        timestamptz NOT NULL DEFAULT now(),
	updated_at        timestamptz NOT NULL DEFAULT now()
);

-- The cron drains the queue oldest-queued first.
CREATE INDEX IF NOT EXISTS idx_forge_creation_descriptions_queue
	ON forge_creation_descriptions (created_at)
	WHERE status = 'queued';

-- Exact tag lookups (a chip on the model page links to a tag search).
CREATE INDEX IF NOT EXISTS idx_forge_creation_descriptions_tags
	ON forge_creation_descriptions USING gin (tags);

-- Substring search over the captions, same ILIKE contract as prompt search.
CREATE INDEX IF NOT EXISTS idx_forge_creation_descriptions_caption_trgm
	ON forge_creation_descriptions USING gin ((coalesce(caption, '') || ' ' || coalesce(detailed, '')) gin_trgm_ops);

-- Backfill walks done creations newest first; this keeps that walk an index scan.
CREATE INDEX IF NOT EXISTS idx_forge_creations_done_recent
	ON forge_creations (created_at DESC)
	WHERE status = 'done' AND glb_url IS NOT NULL;
