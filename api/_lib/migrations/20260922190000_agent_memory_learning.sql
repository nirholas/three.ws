-- Agent memory and learning: memory kinds with provenance, the account-level
-- memory switch, the structured user model, a full-text index over past
-- sessions, cached session summaries, and versioned skills drafted from
-- experience.
--
-- The service layer is api/_lib/agent-learning/. Reader-facing doc:
-- docs/agent-memory.md.

-- ── agent_memories: kind, provenance, confidence ────────────────────────────
-- `type` (user / feedback / project / reference) stays: the Memory Studio, the
-- brain bundle and the reflection pass all read it. `kind` is the vocabulary
-- the agent itself writes with through memory_save:
--   fact        something true about the world or the agent's work
--   preference  how the owner wants things done
--   procedure   how to do a task that worked
-- (user-model entries live in user_model_entries below, per account.)
-- `user_id` is the account the memory was written for, so an agent that
-- changes hands never carries one account's memories into another's prompt.
ALTER TABLE agent_memories ADD COLUMN IF NOT EXISTS kind text;
ALTER TABLE agent_memories ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE agent_memories ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE agent_memories ADD COLUMN IF NOT EXISTS source_run_id uuid;
ALTER TABLE agent_memories ADD COLUMN IF NOT EXISTS source_message_id bigint;
ALTER TABLE agent_memories ADD COLUMN IF NOT EXISTS confidence real NOT NULL DEFAULT 0.7;
DO $$ BEGIN
	ALTER TABLE agent_memories ADD CONSTRAINT agent_memories_kind_check
		CHECK (kind IS NULL OR kind IN ('fact', 'preference', 'procedure'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
	ALTER TABLE agent_memories ADD CONSTRAINT agent_memories_confidence_check
		CHECK (confidence >= 0 AND confidence <= 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The prompt section ranks one agent's memories for one account by use and
-- recency on every turn.
CREATE INDEX IF NOT EXISTS agent_memories_learning_rank
	ON agent_memories (agent_id, user_id, last_accessed_at DESC NULLS LAST, created_at DESC)
	WHERE expires_at IS NULL;

-- ── account memory settings ─────────────────────────────────────────────────
-- One row per account, created on first write. No row means the defaults:
-- memory on, skill drafts on, a nudge every 6 turns. `enabled = false` stops
-- every memory write and every memory injection for the account's agents.
CREATE TABLE IF NOT EXISTS account_memory_settings (
	user_id               uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
	enabled               boolean NOT NULL DEFAULT true,
	skill_drafts_enabled  boolean NOT NULL DEFAULT true,
	nudge_every_turns     int NOT NULL DEFAULT 6 CHECK (nudge_every_turns BETWEEN 2 AND 50),
	updated_at            timestamptz NOT NULL DEFAULT now()
);

-- ── the user model ──────────────────────────────────────────────────────────
-- A structured "about you" document per account, one entry per line, grouped
-- by section. Agents append through memory_save(kind: 'user-model'); the owner
-- reads, edits and deletes every line on /settings/memory. Account-scoped:
-- it is never copied into an agent, a registry or a marketplace transfer.
CREATE TABLE IF NOT EXISTS user_model_entries (
	id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	section          text NOT NULL
		CHECK (section IN ('identity', 'goals', 'preferences', 'communication', 'expertise', 'constraints', 'context')),
	content          text NOT NULL CHECK (length(content) BETWEEN 1 AND 600),
	content_key      text NOT NULL,
	source           text NOT NULL DEFAULT 'agent' CHECK (source IN ('agent', 'owner')),
	source_agent_id  uuid REFERENCES agent_identities(id) ON DELETE SET NULL,
	source_run_id    uuid,
	confidence       real NOT NULL DEFAULT 0.7 CHECK (confidence >= 0 AND confidence <= 1),
	use_count        int NOT NULL DEFAULT 0,
	last_used_at     timestamptz,
	created_at       timestamptz NOT NULL DEFAULT now(),
	updated_at       timestamptz NOT NULL DEFAULT now(),
	UNIQUE (user_id, section, content_key)
);
CREATE INDEX IF NOT EXISTS user_model_entries_user
	ON user_model_entries (user_id, section, updated_at DESC);

-- ── session search ──────────────────────────────────────────────────────────
-- Full-text indexes over what an agent said and did: the shared owner thread
-- (agent_messages), run goals and results (agent_runs) and every run step
-- (agent_run_steps). Generated columns keep the vectors in step with the rows
-- without any writer having to know they exist.
ALTER TABLE agent_messages ADD COLUMN IF NOT EXISTS search_tsv tsvector
	GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED;
CREATE INDEX IF NOT EXISTS agent_messages_search_idx ON agent_messages USING gin (search_tsv);

ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS search_tsv tsvector
	GENERATED ALWAYS AS (to_tsvector('english', coalesce(goal, '') || ' ' || coalesce(result, ''))) STORED;
CREATE INDEX IF NOT EXISTS agent_runs_search_idx ON agent_runs USING gin (search_tsv);

ALTER TABLE agent_run_steps ADD COLUMN IF NOT EXISTS search_tsv tsvector
	GENERATED ALWAYS AS (
		to_tsvector('english', coalesce(tool_name, '') || ' ' || left(coalesce(input::text, ''), 20000) || ' ' || left(coalesce(output::text, ''), 20000))
	) STORED;
CREATE INDEX IF NOT EXISTS agent_run_steps_search_idx ON agent_run_steps USING gin (search_tsv);

-- A summary is generated the first time a search surfaces a session and reused
-- until the session's content changes (content_hash).
CREATE TABLE IF NOT EXISTS agent_session_summaries (
	session_key   text PRIMARY KEY,
	user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	agent_id      uuid NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
	content_hash  text NOT NULL,
	summary       text NOT NULL,
	model         text,
	created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_session_summaries_user ON agent_session_summaries (user_id, agent_id);

-- ── skills learned from experience ──────────────────────────────────────────
-- A run that succeeds after many tool calls drafts a prompt-only custom skill
-- (source 'experience'), saved disabled until the owner reviews it. Every
-- content change to any custom skill is kept as a numbered version so the
-- owner can see what changed, who changed it, and roll back.
ALTER TABLE agent_custom_skills DROP CONSTRAINT IF EXISTS agent_custom_skills_source_check;
ALTER TABLE agent_custom_skills ADD CONSTRAINT agent_custom_skills_source_check
	CHECK (source IN ('custom', 'community', 'experience'));
ALTER TABLE agent_custom_skills ADD COLUMN IF NOT EXISTS source_run_id text;
ALTER TABLE agent_custom_skills ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

CREATE TABLE IF NOT EXISTS agent_custom_skill_versions (
	id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	skill_id      uuid NOT NULL REFERENCES agent_custom_skills(id) ON DELETE CASCADE,
	agent_id      uuid NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
	version_no    int NOT NULL,
	name          text NOT NULL,
	description   text NOT NULL DEFAULT '',
	content       text NOT NULL,
	author        text NOT NULL CHECK (author IN ('owner', 'agent', 'experience', 'rollback')),
	note          text,
	created_at    timestamptz NOT NULL DEFAULT now(),
	UNIQUE (skill_id, version_no)
);
CREATE INDEX IF NOT EXISTS agent_custom_skill_versions_skill
	ON agent_custom_skill_versions (skill_id, version_no DESC);

-- One draft per run (a run id, or a completion id for inline loops), so a
-- retried completion hook never drafts twice.
CREATE UNIQUE INDEX IF NOT EXISTS agent_custom_skills_source_run
	ON agent_custom_skills (source_run_id) WHERE source_run_id IS NOT NULL;
