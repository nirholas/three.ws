-- 20260925150000_launch_venue_chain.sql
--
-- fixed_supply_launches becomes the one table for every launch that is not a
-- Solana bonding curve, on any chain, so /launches and agent profiles can list
-- them beside pump_agent_mints with a venue badge and a chain badge.
--
--   chain  'solana' for every existing row (the home chain); an EVM leg writes
--          its own chain name. Solana rows and Solana code paths are unchanged.
--   venue  'fixed' for the Solana fixed-supply sale; other venues name
--          themselves so the directory can badge them.
--
-- The Solana fixed-supply venue's sale parameters (launch account, raise goal,
-- liquidity share, deposit window) do not exist on a plain fixed-supply EVM
-- token, so they become nullable. The Solana prep path still validates and
-- writes every one of them.

ALTER TABLE fixed_supply_launches ADD COLUMN IF NOT EXISTS chain text NOT NULL DEFAULT 'solana';
ALTER TABLE fixed_supply_launches ADD COLUMN IF NOT EXISTS venue text NOT NULL DEFAULT 'fixed';

ALTER TABLE fixed_supply_launches ALTER COLUMN genesis_account DROP NOT NULL;
ALTER TABLE fixed_supply_launches ALTER COLUMN raise_goal_sol DROP NOT NULL;
ALTER TABLE fixed_supply_launches ALTER COLUMN liquidity_bps DROP NOT NULL;
ALTER TABLE fixed_supply_launches ALTER COLUMN deposit_start_at DROP NOT NULL;
ALTER TABLE fixed_supply_launches ALTER COLUMN deposit_end_at DROP NOT NULL;

CREATE INDEX IF NOT EXISTS fixed_supply_launches_chain_created_idx
	ON fixed_supply_launches (chain, created_at DESC);
