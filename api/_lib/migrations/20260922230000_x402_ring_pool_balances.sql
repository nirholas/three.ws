-- x402 ring payer pool: last recorded on-chain balances per wallet, so the tick's
-- rotation only ever claims a wallet that can pay. The funder (ring-pool-fund)
-- reads every pool wallet's SOL + USDC each run and records it here; the claim
-- (claimNextPayer) requires recorded SOL over its floor, recorded USDC over the
-- price of the call, and a record no older than its freshness window. NULL means
-- never read, which the claim treats as unfunded. A freshly minted pool is all
-- NULL, so growing the pool never hands the tick an empty wallet again (the first
-- 20 claims from the 2,000-wallet pool minted on 2026-09-22 all paid nothing).
-- api/_lib/x402/pool.js ensurePoolSchema() applies the same ALTERs idempotently.

ALTER TABLE x402_ring_pool ADD COLUMN IF NOT EXISTS last_sol_lamports bigint;
ALTER TABLE x402_ring_pool ADD COLUMN IF NOT EXISTS last_usdc_atomic bigint;
ALTER TABLE x402_ring_pool ADD COLUMN IF NOT EXISTS balances_checked_at timestamptz;

COMMENT ON COLUMN x402_ring_pool.last_sol_lamports IS
	'SOL (lamports) the funder last read for this wallet, debited by a fee estimate on each claim. NULL = never read = unfunded.';
COMMENT ON COLUMN x402_ring_pool.last_usdc_atomic IS
	'USDC (6dp atomics) the funder last read for this wallet, debited by the call price on each claim. NULL = never read = unfunded.';
COMMENT ON COLUMN x402_ring_pool.balances_checked_at IS
	'When the funder last recorded balances. The claim ignores records older than X402_RING_POOL_BALANCE_MAX_AGE_MINUTES (default 30).';
