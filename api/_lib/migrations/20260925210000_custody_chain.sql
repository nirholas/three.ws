-- 20260925210000_custody_chain.sql
--
-- The custody ledger (agent_custody_events) gains a `chain` column so an
-- agent's EVM leg (Base, Robinhood Chain) records its transfers, x402 payments
-- and launches in the same owner-viewable ledger as its Solana wallet.
--
-- `chain` is GENERATED from `network`, so no existing writer changes:
--   network 'mainnet' | 'devnet' | 'testnet'   -> 'solana' (every row written so far)
--   network 'base' | 'base-sepolia'            -> 'base'
--   network 'robinhood' | 'robinhood-testnet'  -> 'robinhood'
--
-- EVM writers put the chain slug in `network`. Every Solana spend guard in
-- api/_lib/agent-trade-guards.js already filters its rolling totals by
-- `network = 'mainnet'` (or 'devnet'), so an EVM row can never count against a
-- Solana cap, and a guard called with network 'base' meters Base alone. That is
-- what "guards apply per chain" means in practice, with no change to a single
-- Solana query.

ALTER TABLE agent_custody_events
	ADD COLUMN IF NOT EXISTS chain text GENERATED ALWAYS AS (
		CASE
			WHEN network IN ('mainnet', 'devnet', 'testnet') THEN 'solana'
			WHEN network LIKE 'base%' THEN 'base'
			WHEN network LIKE 'robinhood%' THEN 'robinhood'
			ELSE network
		END
	) STORED;

-- The owner's ledger view filters by chain once an agent has an EVM leg.
CREATE INDEX IF NOT EXISTS agent_custody_events_agent_chain_time
	ON agent_custody_events (agent_id, chain, created_at DESC);

COMMENT ON COLUMN agent_custody_events.chain IS
	'Which chain this custody event happened on, derived from network: solana, base or robinhood. EVM writers store the chain slug in network so Solana guard totals never include them.';
