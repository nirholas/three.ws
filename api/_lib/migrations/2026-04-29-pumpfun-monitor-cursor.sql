-- Migration: in-house pumpfun monitor cursor.
-- Apply: psql "$DATABASE_URL" -f api/_lib/migrations/2026-04-29-pumpfun-monitor-cursor.sql
-- Idempotent.
--
-- Tracks what the cron has already attested per mint so it never emits a
-- duplicate on-chain memo on a re-run. Independent of the claim table; the
-- claim guarantees exactly-once at the tx layer, this cursor cuts the
-- per-tick scan from O(all rows) to O(only-new).

begin;

create table if not exists pumpfun_monitor_cursor (
	mint_id              uuid primary key references pump_agent_mints(id) on delete cascade,
	last_graduated       boolean,
	last_authority       text,
	last_trade_signature text,
	last_processed_at    timestamptz not null default now()
);

commit;
