-- What a multichain launchpad coin is about, and where it launched.
--
-- The multichain launchpad (/launch/multichain) lets a creator launch a coin
-- off any of: a 3D agent they own, an avatar (theirs or a public one), one of
-- the curated animations played on an avatar (for example a public avatar's
-- dance), or a bundle of an agent plus an avatar and an animation. The subject
-- is separate from the signer: the coin can be signed by one of the creator's
-- agent wallets or by their own wallet, on Solana (pump.fun), BNB Chain
-- (four.meme, flap), Base (flap) or Robinhood Chain (flap).
--
-- One row per launch. The row is created before anything is signed and gives
-- the coin a permanent showcase page at /l/:id, which the coin's metadata links
-- to as its website. `prepared` holds what a wallet-signed launch committed to
-- (the metadata CID, the creator address, the salt) so the confirm step can
-- check that the transaction it is shown is that launch and nobody else's.
--
-- Service layer: api/_lib/launch-subjects.js.

CREATE TABLE IF NOT EXISTS launch_subjects (
	id text PRIMARY KEY,
	user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	kind text NOT NULL CHECK (kind IN ('agent', 'avatar', 'animation', 'bundle')),
	agent_id uuid REFERENCES agent_identities(id) ON DELETE SET NULL,
	avatar_id uuid,
	animation text,
	animation_label text,
	title text NOT NULL,
	chain text,
	venue text,
	signer text CHECK (signer IS NULL OR signer IN ('agent', 'wallet')),
	signer_agent_id uuid REFERENCES agent_identities(id) ON DELETE SET NULL,
	creator_address text,
	name text,
	symbol text,
	image_url text,
	description text,
	prepared jsonb NOT NULL DEFAULT '{}'::jsonb,
	launch_record_id uuid,
	token text,
	tx_hash text,
	status text NOT NULL DEFAULT 'draft'
		CHECK (status IN ('draft', 'prepared', 'submitted', 'live', 'failed')),
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	launched_at timestamptz
);

CREATE INDEX IF NOT EXISTS launch_subjects_user_created
	ON launch_subjects (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS launch_subjects_live
	ON launch_subjects (launched_at DESC)
	WHERE status = 'live';

CREATE UNIQUE INDEX IF NOT EXISTS launch_subjects_chain_token
	ON launch_subjects (chain, lower(token))
	WHERE token IS NOT NULL;
