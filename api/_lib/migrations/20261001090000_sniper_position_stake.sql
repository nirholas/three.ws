-- Migration: record each sniper position's original stake, and correct the
-- realized % on laddered trades that was computed against the wrong basis.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261001090000_sniper_position_stake.sql
-- Idempotent.
--
-- After a take-initials leg, executeSell scales entry_quote_lamports down to the
-- cost basis of the moon bag that remains, which the exit rules need. The final
-- close then divided cumulative realized P&L by that REDUCED basis, so every
-- laddered trade booked roughly double its true return (a +73% trade stored as
-- +215%). realized_pnl_pct feeds the optimizer, the leaderboard, trader stats and
-- the Oracle calibration, so the inflation propagated everywhere.
--
-- stake_lamports is the SOL actually committed at entry. The worker writes it on
-- every fill from now on and divides by it at close. Historical rows are
-- backfilled from what is provable:
--   * never laddered: the stake is entry_quote_lamports, which was never scaled;
--   * laddered with a take_initials journal entry: the basis was scaled by
--     (1 - sold_fraction), so the stake is entry_quote_lamports / (1 - sold_fraction);
--   * laddered with no journal entry (7 rows at the time of writing): left NULL,
--     because the original stake cannot be recovered without guessing.

alter table agent_sniper_positions
	add column if not exists stake_lamports numeric(40, 0);

update agent_sniper_positions
set stake_lamports = entry_quote_lamports
where stake_lamports is null
  and entry_quote_lamports is not null
  and initials_recovered is not true;

update agent_sniper_positions p
set stake_lamports = round(p.entry_quote_lamports / (1 - j.sold_fraction))
from (
	select distinct on (position_id) position_id, sold_fraction
	from trading_journal
	where event = 'take_initials' and sold_fraction > 0 and sold_fraction < 1
	order by position_id, ts
) j
where p.id = j.position_id
  and p.stake_lamports is null
  and p.initials_recovered = true
  and p.entry_quote_lamports is not null;

update agent_sniper_positions
set realized_pnl_pct = realized_pnl_lamports / stake_lamports * 100
where initials_recovered = true
  and status = 'closed'
  and stake_lamports > 0
  and realized_pnl_lamports is not null;
