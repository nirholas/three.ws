-- External skill import: install SKILL.md skills from any public GitHub
-- repository or skill-registry manifest, pinned to the exact upstream bytes.
--
-- An imported skill becomes an ordinary prompt-only row in agent_custom_skills
-- with source 'external', so nothing from an outside repository ever executes:
-- scripts and handlers next to a SKILL.md are listed in the scan and never run.
-- `provenance` records where the bytes came from (registry, repo, commit, path,
-- blob sha, licence, author) and `gated` marks a skill that asks for spending,
-- signing or outbound messaging, which the chat route holds behind the owner's
-- approval. Logic lives in api/_lib/skill-import-*.js; docs in docs/skill-import.md.

ALTER TABLE agent_custom_skills DROP CONSTRAINT IF EXISTS agent_custom_skills_source_check;
ALTER TABLE agent_custom_skills
	ADD CONSTRAINT agent_custom_skills_source_check CHECK (source IN ('custom', 'community', 'external'));

ALTER TABLE agent_custom_skills ADD COLUMN IF NOT EXISTS provenance jsonb;
ALTER TABLE agent_custom_skills ADD COLUMN IF NOT EXISTS gated boolean NOT NULL DEFAULT false;
ALTER TABLE agent_custom_skills ADD COLUMN IF NOT EXISTS forked_from uuid;

-- Install counts on the browse view group external rows by their provenance key.
CREATE INDEX IF NOT EXISTS agent_custom_skills_external_key
	ON agent_custom_skills ((provenance ->> 'key'))
	WHERE source = 'external';

-- Registries an owner added beyond the built-in defaults.
CREATE TABLE IF NOT EXISTS skill_import_registries (
	id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	kind        text NOT NULL CHECK (kind IN ('github', 'manifest')),
	key         text NOT NULL,
	label       text NOT NULL,
	spec        jsonb NOT NULL,
	created_at  timestamptz NOT NULL DEFAULT now(),
	UNIQUE (user_id, key)
);

-- One scan of one upstream skill at one pinned revision, waiting for the
-- owner's decision. Approving installs (or, with replaces_skill_id, updates)
-- exactly the bytes that were scanned, never a re-fetch.
CREATE TABLE IF NOT EXISTS skill_import_requests (
	id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	agent_id           uuid NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
	replaces_skill_id  uuid REFERENCES agent_custom_skills(id) ON DELETE CASCADE,
	skill_key          text NOT NULL,
	slug               text NOT NULL,
	name               text NOT NULL,
	description        text NOT NULL DEFAULT '',
	content            text NOT NULL,
	content_sha256     text NOT NULL,
	manifest           jsonb NOT NULL,
	provenance         jsonb NOT NULL,
	scan               jsonb NOT NULL,
	verdict            text NOT NULL CHECK (verdict IN ('clean', 'flagged', 'refused')),
	gated              boolean NOT NULL DEFAULT false,
	status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'refused')),
	decided_by         text CHECK (decided_by IN ('owner', 'scanner')),
	installed_skill_id uuid,
	created_at         timestamptz NOT NULL DEFAULT now(),
	decided_at         timestamptz,
	expires_at         timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);

CREATE INDEX IF NOT EXISTS skill_import_requests_user_recent
	ON skill_import_requests (user_id, created_at DESC);

-- Skills an owner published to the three.ws skill registry manifest
-- (/api/skill-imports/published/manifest.json). The snapshot is frozen at
-- publish time; publishing again replaces it with a new revision.
CREATE TABLE IF NOT EXISTS skill_publications (
	id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	skill_id        uuid REFERENCES agent_custom_skills(id) ON DELETE SET NULL,
	slug            text NOT NULL UNIQUE,
	name            text NOT NULL,
	description     text NOT NULL DEFAULT '',
	author          text,
	tags            text[] NOT NULL DEFAULT '{}',
	category        text NOT NULL,
	license         text NOT NULL,
	version         text NOT NULL DEFAULT '1.0.0',
	content         text NOT NULL,
	content_sha256  text NOT NULL,
	attribution     jsonb,
	published_at    timestamptz NOT NULL DEFAULT now(),
	updated_at      timestamptz NOT NULL DEFAULT now(),
	unpublished_at  timestamptz
);

CREATE INDEX IF NOT EXISTS skill_publications_live
	ON skill_publications (updated_at DESC)
	WHERE unpublished_at IS NULL;
