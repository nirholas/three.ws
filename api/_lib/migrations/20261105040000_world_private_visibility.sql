-- Private worlds (the Silver `worlds.private` $THREE perk). A world doc is public
-- by default, so every existing row is untouched. A private world is readable only
-- by its owner, the accounts listed in `invitees`, and the authoritative game
-- server. `invitees` holds user ids (text, matching owner_id), capped in the
-- handler (api/world/[action].js), never trusted from the client.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261105040000_world_private_visibility.sql
-- Idempotent and additive. Writers: api/_lib/world-store.js. Docs: docs/hold-to-access.md.

ALTER TABLE world_docs ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'public';
ALTER TABLE world_docs ADD COLUMN IF NOT EXISTS invitees text[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'world_docs_visibility_check'
	) THEN
		ALTER TABLE world_docs
			ADD CONSTRAINT world_docs_visibility_check CHECK (visibility IN ('public', 'private'));
	END IF;
END $$;

-- "Which private worlds can this account read?" (invitee lookups).
CREATE INDEX IF NOT EXISTS world_docs_invitees_idx ON world_docs USING gin (invitees) WHERE visibility = 'private';
