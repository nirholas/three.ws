-- Skill candidates: procedures an agent followed to a verified success, kept as
-- a reviewable draft skill bundle (api/_lib/skill-candidates.js).
--
-- A row is created only after a verified success signal (a passed labor-escrow
-- job, a multi-tool turn with no tool error, or a closed profitable trade).
-- `steps` and `goal` are redacted before they reach this table: argument
-- shapes only, never values. `bundle` is the four-file draft
-- (manifest, skill_md, tools, handlers_src); a draft that fails validation is
-- kept with `validation_errors` and `status = 'invalid'`, and is never
-- installable or publishable.
--
-- Nothing here installs or publishes by itself. `installed_at` and
-- `published_skill_id` are set only by an owner action on the agent dashboard
-- (POST /api/agents/:id/skill-candidates/:candidateId). This is a different
-- store from agent_custom_skills (prompt-only drafts, api/_lib/agent-learning)
-- and openapi_skill_imports (bundles generated from an external spec).

CREATE TABLE IF NOT EXISTS agent_skill_candidates (
	id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	agent_id            uuid NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
	user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	signal              text NOT NULL CHECK (signal IN ('multi_tool_turn', 'labor_escrow_passed', 'profitable_trade')),
	source_ref          text NOT NULL,
	goal                text NOT NULL,
	steps               jsonb NOT NULL,
	outcome             jsonb NOT NULL DEFAULT '{}'::jsonb,
	status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'invalid', 'installed', 'dismissed')),
	plan                jsonb,
	bundle              jsonb,
	validation_errors   jsonb,
	model               text,
	revisions           jsonb NOT NULL DEFAULT '[]'::jsonb,
	installed_at        timestamptz,
	published_skill_id  uuid REFERENCES marketplace_skills(id) ON DELETE SET NULL,
	created_at          timestamptz NOT NULL DEFAULT now(),
	updated_at          timestamptz NOT NULL DEFAULT now(),
	UNIQUE (agent_id, source_ref)
);

CREATE INDEX IF NOT EXISTS agent_skill_candidates_agent_recent
	ON agent_skill_candidates (agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS agent_skill_candidates_installed
	ON agent_skill_candidates (agent_id) WHERE status = 'installed';
