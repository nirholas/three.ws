-- Migration: Event Markets auto-resolution (evidence, retry bookkeeping, admin overrides).
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261012130000_event_market_resolution.sql
-- Idempotent. Requires the event_markets table.
--
-- Library: api/_lib/event-markets/{lifecycle,override}.js and resolvers/. Docs:
-- docs/event-markets.md (section "How markets resolve").
--
--   event_markets.resolution_evidence  the inputs the resolver read (ids, values,
--                                      timestamps), written in the same statement
--                                      that flips the status, so a settled market
--                                      can never lack its proof.
--   event_markets.resolution_source    'auto' (the cron) or 'override' (an admin).
--   event_markets.pending_*            retry bookkeeping: when the source first
--                                      answered "not yet", how often it was asked,
--                                      and why. The timeout clock starts at resolves_at.
--   event_market_overrides             append-only log of admin overrides. Each row
--                                      keeps the written reason, who acted and what
--                                      the market looked like before.

alter table event_markets add column if not exists resolved_at         timestamptz;
alter table event_markets add column if not exists resolution_evidence jsonb;
alter table event_markets add column if not exists resolution_source   text;
alter table event_markets add column if not exists last_checked_at     timestamptz;
alter table event_markets add column if not exists check_count         integer not null default 0;
alter table event_markets add column if not exists pending_reason      text;

do $$ begin
	alter table event_markets add constraint event_markets_resolution_source_chk
		check (resolution_source is null or resolution_source in ('auto', 'override'));
exception when duplicate_object then null; end $$;

create index if not exists event_markets_resolution_due
	on event_markets(resolves_at) where status in ('open', 'locked');

create table if not exists event_market_overrides (
	id                  uuid primary key default gen_random_uuid(),
	market_id           uuid not null references event_markets(id) on delete cascade,
	admin_id            uuid not null references users(id),
	action              text not null check (action in ('set_winner', 'void')),
	reason              text not null check (char_length(reason) >= 20),
	previous_status     text not null,
	previous_winner_id  uuid,
	new_winner_id       uuid,
	previous_evidence   jsonb,
	rescored_picks      integer not null default 0,
	created_at          timestamptz not null default now()
);
create index if not exists event_market_overrides_market on event_market_overrides(market_id, created_at desc);
