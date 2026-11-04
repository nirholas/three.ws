-- Migration: let a retained agent sale outlive the listing and bid it came from.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261104220000_account_purge_transfer_links.sql
-- Idempotent.
--
-- An agent_transfers row is the retained record of a completed agent sale
-- (amounts, fee, payout and fee signatures). When the purge removes a deleted
-- seller's account it deletes the seller's listing and the bids on it
-- (api/_lib/account-purge.js, EDGE_POLICY), and unlinks the sale from both.
-- 20261104180000_account_purge.sql dropped NOT NULL on the sale's agent, buyer
-- and seller links but not on these two, so a seller with any completed sale
-- failed every purge with fk_not_nullable:agent_transfers.listing_id. The
-- foreign keys and unique constraints stay as they are; several NULLs are
-- allowed under a unique constraint.

do $$
declare
	target record;
begin
	for target in
		select * from (values
			('agent_transfers', 'listing_id'),
			('agent_transfers', 'bid_id')
		) as t(tbl, col)
	loop
		if exists (
			select 1 from information_schema.columns
			where table_schema = current_schema()
			  and table_name = target.tbl
			  and column_name = target.col
			  and is_nullable = 'NO'
		) then
			execute format('alter table %I alter column %I drop not null', target.tbl, target.col);
		end if;
	end loop;
end
$$;
