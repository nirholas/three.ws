-- Temporal validity and provenance for agent memory.
--
-- A fact is true over an interval, not forever ("lives in Paris", then "moved
-- to Berlin"). Without the interval the agent states the stale version with
-- the same confidence as the current one.
--
--   valid_from     when the fact became true (defaults to when it was written)
--   valid_to       when it stopped being true; NULL means still current
--   source_ref     where the fact came from, a free-form pointer such as
--                  "message:4812", "run:<uuid>" or "https://..."
--   superseded_by  the newer memory that replaced this one; set together with
--                  valid_to when a fact is superseded
--
-- Backfill: every existing row is a current fact that became true when it was
-- created, so valid_from = created_at and valid_to stays NULL. source_ref is
-- derived from the provenance columns the learning layer already records.

ALTER TABLE agent_memories ADD COLUMN IF NOT EXISTS valid_from timestamptz;
ALTER TABLE agent_memories ADD COLUMN IF NOT EXISTS valid_to timestamptz;
ALTER TABLE agent_memories ADD COLUMN IF NOT EXISTS source_ref text;
ALTER TABLE agent_memories ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES agent_memories(id) ON DELETE SET NULL;

UPDATE agent_memories SET valid_from = created_at WHERE valid_from IS NULL;
UPDATE agent_memories
SET source_ref = CASE
	WHEN source_message_id IS NOT NULL THEN 'message:' || source_message_id::text
	WHEN source_run_id IS NOT NULL THEN 'run:' || source_run_id::text
	ELSE NULL
END
WHERE source_ref IS NULL;

ALTER TABLE agent_memories ALTER COLUMN valid_from SET DEFAULT now();
ALTER TABLE agent_memories ALTER COLUMN valid_from SET NOT NULL;

DO $$ BEGIN
	ALTER TABLE agent_memories ADD CONSTRAINT agent_memories_validity_check
		CHECK (valid_to IS NULL OR valid_to >= valid_from);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- "Current facts for this agent" is the hot path (every prompt, every search);
-- the as-of query walks the same index.
CREATE INDEX IF NOT EXISTS agent_memories_validity
	ON agent_memories (agent_id, valid_from DESC)
	WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS agent_memories_superseded_by
	ON agent_memories (superseded_by)
	WHERE superseded_by IS NOT NULL;
