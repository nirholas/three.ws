-- Prompt-only custom skills: instruction sets installed on one agent.
--
-- A prompt skill is a SKILL.md and a little metadata, nothing executable. The
-- owner writes one by hand or imports one from the community registry
-- (community-skills/, /skills/community), and every enabled skill is injected
-- into that agent's system prompt in install order, inside a per-agent token
-- budget (api/_lib/agent-custom-skills.js). Rows are owned by the agent's
-- owner and edited freely after import; `source_sha256` remembers which
-- registry revision an imported skill came from so the UI can offer an update.

CREATE TABLE IF NOT EXISTS agent_custom_skills (
	id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	agent_id        uuid NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
	user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	kind            text NOT NULL DEFAULT 'prompt' CHECK (kind IN ('prompt')),
	slug            text NOT NULL,
	name            text NOT NULL,
	description     text NOT NULL DEFAULT '',
	author          text,
	tags            text[] NOT NULL DEFAULT '{}',
	version         text NOT NULL DEFAULT '1.0.0',
	content         text NOT NULL,
	source          text NOT NULL DEFAULT 'custom' CHECK (source IN ('custom', 'community')),
	source_slug     text,
	source_version  text,
	source_sha256   text,
	enabled         boolean NOT NULL DEFAULT true,
	installed_at    timestamptz NOT NULL DEFAULT now(),
	updated_at      timestamptz NOT NULL DEFAULT now(),
	UNIQUE (agent_id, slug)
);

-- The chat path reads one agent's enabled skills in install order on every turn.
CREATE INDEX IF NOT EXISTS agent_custom_skills_agent_order
	ON agent_custom_skills (agent_id, installed_at, id);
