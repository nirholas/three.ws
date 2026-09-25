-- 20260925230000_custody_ledger_chain.sql
--
-- The custody ledger (agent_custody_events) records every movement the
-- platform signs for an agent wallet. Agents now also hold an EVM address (one
-- address across Base and Robinhood Chain), so each row names the chain it
-- happened on.
--
--   chain  'solana' for every existing row and every Solana writer, which does
--          not set it; the EVM leg (api/_lib/evm-leg/) writes 'base' or
--          'robinhood', and sets `network` to the same chain key, so the
--          Solana spend ceilings (which sum network = 'mainnet' or 'devnet')
--          never count an EVM spend, and the EVM ceilings never count a
--          Solana one.
--
-- Additive and idempotent: existing rows take the default, no Solana path
-- changes behavior.

ALTER TABLE agent_custody_events ADD COLUMN IF NOT EXISTS chain text NOT NULL DEFAULT 'solana';

-- The per-chain spend ceiling sums one chain's recent spend rows per agent.
CREATE INDEX IF NOT EXISTS agent_custody_events_chain_spend
	ON agent_custody_events (agent_id, chain, created_at)
	WHERE event_type = 'spend';
