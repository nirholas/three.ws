-- Migration: platform_fee_events, one append-only row per platform fee taken.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261104150000_platform_fee_events.sql
-- Idempotent.
--
-- Every fee three.ws takes (the 1% pump trade fee on wallet-signed and
-- server-signed trades, the launch fee on a dev buy, the marketplace skill and
-- bundle fee, the subscription fee, the platform share of an x402 skill call)
-- lands here exactly once, written by api/_lib/platform-fee-events.js in the
-- same database transaction as the money-state change it belongs to.
--
-- Why a separate table and not revenue_ledger_entries: that ledger records the
-- CREATOR's income (net of fees, keyed to the user who earned it). A platform
-- fee is the platform's income on the same transaction, a different fact with
-- a different owner, so it gets its own writer. platform_fee_revenue_v joins
-- the two on the transaction signature so finance can see both legs together.
--
-- settlement:
--   onchain  the fee is its own on-chain transfer to the platform fee wallet
--            (beneficiary) inside tx_signature. scripts/reconcile-platform-fees.mjs
--            proves each one against the chain and flags fee-wallet receipts
--            that have no row here.
--   ledger   the platform's share is an accounting split of a payment that was
--            settled in one piece (x402 skill calls); there is no separate
--            transfer to check, so these are totalled but not chain-matched.
--
-- Append-only is enforced in the database, not by convention: a trigger
-- refuses UPDATE, DELETE and TRUNCATE. Correcting a row means appending a
-- reversing entry, never editing history.

begin;

create table if not exists platform_fee_events (
	id              bigserial primary key,
	source          text not null check (source in (
		'pump_trade', 'pump_launch', 'agent_trade', 'skill_purchase',
		'skill_bundle', 'subscription', 'x402_skill_split'
	)),
	source_ref      text not null check (length(source_ref) between 1 and 200),
	settlement      text not null default 'onchain' check (settlement in ('onchain', 'ledger')),
	chain           text not null default 'solana',
	network         text not null default 'mainnet',
	asset           text not null,
	asset_mint      text,
	amount_atomics  numeric(40, 0) not null check (amount_atomics > 0),
	decimals        int not null check (decimals between 0 and 18),
	bps             int check (bps between 0 and 10000),
	basis           text,
	tx_signature    text,
	payer           text,
	beneficiary     text,
	user_id         uuid,
	agent_id        uuid,
	meta            jsonb not null default '{}'::jsonb,
	occurred_at     timestamptz not null default now(),
	created_at      timestamptz not null default now(),
	unique (source, source_ref),
	check (settlement = 'ledger' or (tx_signature is not null and beneficiary is not null))
);

create index if not exists platform_fee_events_created_at
	on platform_fee_events (created_at desc);
create index if not exists platform_fee_events_tx_signature
	on platform_fee_events (tx_signature) where tx_signature is not null;
create index if not exists platform_fee_events_beneficiary_time
	on platform_fee_events (beneficiary, occurred_at desc) where beneficiary is not null;

create or replace function platform_fee_events_append_only()
returns trigger
language plpgsql
as $$
begin
	raise exception 'platform_fee_events is append-only: % is not allowed', tg_op
		using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists platform_fee_events_no_update on platform_fee_events;
create trigger platform_fee_events_no_update
	before update or delete on platform_fee_events
	for each row execute function platform_fee_events_append_only();

drop trigger if exists platform_fee_events_no_truncate on platform_fee_events;
create trigger platform_fee_events_no_truncate
	before truncate on platform_fee_events
	for each statement execute function platform_fee_events_append_only();

-- Daily fee totals per stream, the unit the reconciler and finance work in.
create or replace view platform_fee_daily as
select
	(occurred_at at time zone 'utc')::date as day,
	source,
	settlement,
	chain,
	network,
	asset,
	asset_mint,
	beneficiary,
	count(*)::int        as events,
	sum(amount_atomics)  as amount_atomics,
	max(decimals)        as decimals
from platform_fee_events
group by 1, 2, 3, 4, 5, 6, 7, 8;

-- The fee leg beside the creator's income leg of the same transaction.
create or replace view platform_fee_revenue_v as
select
	f.id               as fee_event_id,
	f.source           as fee_source,
	f.source_ref       as fee_source_ref,
	f.occurred_at,
	f.chain,
	f.network,
	f.asset,
	f.amount_atomics   as fee_atomics,
	f.decimals         as fee_decimals,
	f.tx_signature,
	r.id               as revenue_entry_id,
	r.source           as revenue_source,
	r.user_id          as revenue_user_id,
	r.amount_atomics   as revenue_atomics,
	r.decimals         as revenue_decimals
from platform_fee_events f
left join revenue_ledger_entries r
	on r.tx_signature = f.tx_signature and r.chain = f.chain;

commit;
