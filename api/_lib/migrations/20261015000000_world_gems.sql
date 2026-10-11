-- World gems: the ledger behind gem mining in the three.ws world (the 3D entry
-- to the web desktop at /). One row per gem mined. The server rolls the gem
-- and enforces the mining cadence, so a client can only ever ask "I finished
-- a dig at this node", never "give me a diamond".
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261015000000_world_gems.sql
-- Idempotent and additive. Writer: api/world/gems.js. Docs: docs/desktop.md.

CREATE TABLE IF NOT EXISTS world_gems (
	id          bigserial PRIMARY KEY,
	-- Exactly one of user_id / anon_id identifies the miner. Anonymous miners
	-- supply a stable browser id, the same convention walk_metrics uses, and
	-- their gems move to the account on the first signed-in dig.
	user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
	anon_id     text,
	node        text NOT NULL,
	gem         text NOT NULL,
	amount      integer NOT NULL DEFAULT 1 CHECK (amount > 0),
	mined_at    timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT world_gems_miner_present CHECK (user_id IS NOT NULL OR anon_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS world_gems_user_idx ON world_gems (user_id, mined_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS world_gems_anon_idx ON world_gems (anon_id, mined_at DESC) WHERE anon_id IS NOT NULL;
