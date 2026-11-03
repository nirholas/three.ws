-- 20261103010000_x402_audit_durability.sql
--
-- Makes the x402 payment audit ledger safe to replay and impossible to drop
-- silently.
--
--   x402_audit_dead_letter   parking table for audit events that could not be
--                            written (and for duplicate rows removed by the
--                            dedupe below, reason = 'dedupe'). Nothing is ever
--                            deleted without a copy landing here first.
--   ux_x402_audit_tx_event   partial UNIQUE index on (tx_hash, event_type) where
--                            tx_hash is not null, so a replayed flush or a
--                            retried request inserts the same on-chain event once
--                            and the table can be reconciled against the chain.
--
-- Additive. The dedupe keeps the earliest row per key and copies each later row
-- (full row as jsonb) into the dead-letter table before removing it.

create table if not exists x402_audit_dead_letter (
  id bigserial primary key,
  payload jsonb not null,
  reason text not null default 'insert_failed',
  error text,
  attempts integer not null default 0,
  first_failed_at timestamptz not null default now(),
  last_failed_at timestamptz not null default now()
);

create index if not exists idx_x402_audit_dead_letter_reason
  on x402_audit_dead_letter (reason, first_failed_at);

with ranked as (
  select id,
         row_number() over (
           partition by tx_hash, event_type
           order by created_at asc nulls last, id asc
         ) as rn
  from x402_audit_log
  where tx_hash is not null
),
dupes as (
  select id from ranked where rn > 1
),
parked as (
  insert into x402_audit_dead_letter (payload, reason, error, attempts)
  select to_jsonb(l), 'dedupe', 'duplicate (tx_hash, event_type) removed before unique index', 0
  from x402_audit_log l
  join dupes d on d.id = l.id
  returning 1
)
-- The parked CTE is data-modifying, so Postgres runs it to completion whether or
-- not it is referenced: every removed row has its copy before the commit.
delete from x402_audit_log
where id in (select id from dupes);

create unique index if not exists ux_x402_audit_tx_event
  on x402_audit_log (tx_hash, event_type)
  where tx_hash is not null;
