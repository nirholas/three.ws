-- Per-coin reconciled creator earnings (work order 510-integrate-11): a second,
-- independent figure for agent_coin_earnings, summed from each coin's own
-- distribution timeline (swap-api /v1/coins/<mint>/timeline) rather than the
-- wallet-level creator-fee index that earned_lamports already carries.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261015090000_agent_coin_earnings_timeline.sql
-- Idempotent.
--
-- coin_earned_lamports   this coin's own share of distribution events paid to
--                        its creator wallet, summed straight off the mint's
--                        timeline. Unlike earned_lamports (one wallet-level
--                        total smeared across every coin that wallet created),
--                        this is specific to the one coin.
-- coin_distributions     how many distribution events contributed.
-- coin_earnings_source   'timeline' once the per-coin read has succeeded at
--                        least once; null (the default) means only the
--                        wallet-level figure has ever been read for this coin.
-- reconciliation_delta_lamports / reconciliation_pct
--                        wallet-level: sum of coin_earned_lamports across every
--                        coin of the creator wallet, minus that wallet's
--                        claimed_lamports. Stored on every coin row of the
--                        wallet, same pattern as the existing wallet-smeared
--                        columns. A nonzero delta is surfaced, not hidden.

begin;

alter table agent_coin_earnings add column if not exists coin_earned_lamports bigint;
alter table agent_coin_earnings add column if not exists coin_distributions integer;
alter table agent_coin_earnings add column if not exists coin_earnings_source text;
alter table agent_coin_earnings add column if not exists reconciliation_delta_lamports bigint;
alter table agent_coin_earnings add column if not exists reconciliation_pct double precision;

alter table agent_coin_earnings drop constraint if exists agent_coin_earnings_coin_earnings_source_check;
alter table agent_coin_earnings
	add constraint agent_coin_earnings_coin_earnings_source_check
	check (coin_earnings_source is null or coin_earnings_source in ('timeline'));

commit;
