-- 20260922190000_launch_venues_gasless.sql
--
-- Two launch capabilities land together, and they share this migration because
-- both are read by the same launch directory and the same eligibility check.
--
-- 1. Gasless launches. A creator with no SOL can launch a bonding-curve coin:
--    the platform launch sponsor pays rent and network fees, and in return the
--    coin's creator fees are split on-chain between the creator and the platform
--    (the split comes from the `launch_economics` row in app_settings, the same
--    setting the fee claimer reads). `launch_sponsorships` is the ledger of every
--    sponsored launch: what the sponsor spent, what share it holds, and how much
--    of the spend the fee distribution has recovered so far. It also backs the
--    per-account and platform-wide daily caps, so a cap is only ever computed
--    from sponsorships the platform actually committed to.
--
-- 2. Fixed-supply launches. A second Solana venue that is not a bonding curve:
--    a fixed 1B supply with a set allocation sold in a 48-hour deposit window at
--    one clearing price, graduating into an AMM pool. `fixed_supply_launches` has
--    the shape of pump_agent_mints (mint + network keyed, agent + user
--    attributed) so /launches and agent profiles list both kinds side by side
--    with a venue badge. It is a separate table because every consumer of
--    pump_agent_mints (trading, fee claims, buybacks) assumes a bonding-curve mint.

CREATE TABLE IF NOT EXISTS app_settings (
	key        text PRIMARY KEY,
	value      jsonb NOT NULL,
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS launch_sponsorships (
	id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id                     uuid NOT NULL,
	agent_id                    uuid,
	network                     text NOT NULL DEFAULT 'mainnet',
	mint                        text NOT NULL,
	creator_address             text NOT NULL,
	sponsor_address             text NOT NULL,
	prep_id                     text,
	signature                   text,
	-- Measured from the prepared transaction's simulation, never estimated.
	sponsored_lamports          bigint NOT NULL DEFAULT 0,
	platform_share_bps          integer NOT NULL,
	-- Running total of creator fees paid to the platform's shareholder slot.
	recovered_lamports          bigint NOT NULL DEFAULT 0,
	last_distribution_signature text,
	last_distribution_at        timestamptz,
	-- 'prepared' until the launch lands, then 'launched'; 'expired' if never sent.
	status                      text NOT NULL DEFAULT 'prepared',
	created_at                  timestamptz NOT NULL DEFAULT now(),
	launched_at                 timestamptz,
	UNIQUE (mint, network)
);

CREATE INDEX IF NOT EXISTS launch_sponsorships_user_created_idx
	ON launch_sponsorships (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS launch_sponsorships_status_created_idx
	ON launch_sponsorships (status, created_at DESC);

CREATE TABLE IF NOT EXISTS fixed_supply_launches (
	id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	agent_id          uuid,
	user_id           uuid NOT NULL,
	network           text NOT NULL DEFAULT 'mainnet',
	mint              text NOT NULL,
	genesis_account   text NOT NULL,
	name              text NOT NULL,
	symbol            text NOT NULL,
	image_url         text,
	description       text,
	creator_address   text NOT NULL,
	token_allocation  bigint NOT NULL,
	raise_goal_sol    numeric NOT NULL,
	liquidity_bps     integer NOT NULL,
	deposit_start_at  timestamptz NOT NULL,
	deposit_end_at    timestamptz NOT NULL,
	signatures        jsonb NOT NULL DEFAULT '[]'::jsonb,
	venue_url         text,
	created_at        timestamptz NOT NULL DEFAULT now(),
	UNIQUE (mint, network)
);

CREATE INDEX IF NOT EXISTS fixed_supply_launches_network_created_idx
	ON fixed_supply_launches (network, created_at DESC);
CREATE INDEX IF NOT EXISTS fixed_supply_launches_agent_created_idx
	ON fixed_supply_launches (agent_id, created_at DESC);
