-- Event Markets staking (brief 10): pool registry, stake ledger, kill switch, attestations.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261013000000_event_market_staking.sql
-- Idempotent and additive. Nothing here touches event_market_picks, so staked and
-- free-to-play standings can never mix. Docs: docs/event-markets-staking.md.

-- One on-chain pool per market. Created only by the owner-gated admin CLI.
CREATE TABLE IF NOT EXISTS event_market_stake_pools (
	market_id           uuid PRIMARY KEY REFERENCES event_markets(id) ON DELETE CASCADE,
	cluster             text NOT NULL CHECK (cluster IN ('localnet', 'devnet', 'mainnet')),
	program_id          text NOT NULL,
	pool_id_hex         text NOT NULL,
	pool_address        text NOT NULL UNIQUE,
	mint                text NOT NULL,
	token_key           text NOT NULL CHECK (token_key IN ('usdc', 'three')),
	decimals            smallint NOT NULL CHECK (decimals BETWEEN 0 AND 18),
	outcome_ids         uuid[] NOT NULL,
	min_stake           numeric(40, 0) NOT NULL CHECK (min_stake > 0),
	max_stake           numeric(40, 0) NOT NULL,
	max_pool            numeric(40, 0) NOT NULL,
	fee_bps             integer NOT NULL CHECK (fee_bps BETWEEN 0 AND 1000),
	buyback_share_bps   integer NOT NULL CHECK (buyback_share_bps BETWEEN 0 AND 10000),
	lock_at             timestamptz NOT NULL,
	void_after          timestamptz NOT NULL,
	status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'void')),
	create_signature    text NOT NULL,
	resolve_signature   text,
	created_at          timestamptz NOT NULL DEFAULT now(),
	CHECK (max_stake >= min_stake AND max_pool >= max_stake AND void_after > lock_at)
);

-- Every confirmed stake, claim and refund, recorded from the verified transaction
-- (never from the client's say-so). The admin reconciliation view compares this
-- ledger to the chain.
CREATE TABLE IF NOT EXISTS event_market_stakes (
	id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	market_id     uuid NOT NULL REFERENCES event_market_stake_pools(market_id) ON DELETE CASCADE,
	account_id    uuid REFERENCES users(id) ON DELETE SET NULL,
	wallet        text NOT NULL,
	kind          text NOT NULL CHECK (kind IN ('stake', 'claim', 'refund')),
	outcome_index smallint,
	amount        numeric(40, 0) NOT NULL CHECK (amount >= 0),
	signature     text NOT NULL UNIQUE,
	slot          bigint NOT NULL,
	created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_market_stakes_market_idx ON event_market_stakes (market_id, kind);
CREATE INDEX IF NOT EXISTS event_market_stakes_account_idx ON event_market_stakes (account_id, created_at DESC);

-- Single-row switch. stakes_enabled = false stops new stake transactions being built
-- the instant it is written; claims and refunds are never blocked by it.
CREATE TABLE IF NOT EXISTS event_market_stake_settings (
	id             smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
	stakes_enabled boolean NOT NULL DEFAULT true,
	updated_by     uuid REFERENCES users(id) ON DELETE SET NULL,
	updated_at     timestamptz NOT NULL DEFAULT now()
);
INSERT INTO event_market_stake_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

-- An account's own attestation that it meets the age and jurisdiction terms.
CREATE TABLE IF NOT EXISTS event_market_stake_attestations (
	account_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
	min_age       smallint NOT NULL,
	country       char(2) NOT NULL,
	terms_version text NOT NULL,
	attested_at   timestamptz NOT NULL DEFAULT now()
);
