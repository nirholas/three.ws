-- Migration: Event Markets live odds feed (stream log, notable moves, DB triggers).
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261012200000_event_market_live_feed.sql
-- Idempotent. Requires the event_markets / event_market_picks tables.
--
-- Library: api/_lib/event-markets/{events,feed,hub}.js. Docs: docs/event-markets.md
-- (section "Live feed").
--
--   event_market_events      append-only log the SSE stream serves. `id` is the SSE
--                            event id, so Last-Event-ID resumes without gaps or
--                            duplicates on any Cloud Run instance. Raw rows (pick,
--                            open, lock, resolve) are written by the triggers below;
--                            derived rows (odds, move) by feed.js. Account ids are
--                            never written here: the feed is anonymous by design.
--   event_market_feed_state  one row: the log id up to which raw rows were processed.
--   event_market_moves       one row per notable odds move, unique per (market,
--                            outcome, window bucket) so a crossing is recorded once.
--                            The announcement brief reads this table.
--
-- Triggers capture every write path (the REST route, cron resolvers, agent
-- forecasters), so no caller has to remember to emit an event.

create table if not exists event_market_events (
	id          bigserial primary key,
	market_id   uuid not null references event_markets(id) on delete cascade,
	kind        text not null check (kind in ('open','pick','odds','move','lock','resolve')),
	payload     jsonb not null default '{}'::jsonb,
	created_at  timestamptz not null default now()
);
create index if not exists event_market_events_market on event_market_events(market_id, id);
create index if not exists event_market_events_created on event_market_events(created_at);
create index if not exists event_market_events_kind_created on event_market_events(kind, created_at);
-- A market opens, locks and resolves once; the time-based lock sweep relies on this.
create unique index if not exists event_market_events_once
	on event_market_events(market_id, kind) where kind in ('open','lock','resolve');

create table if not exists event_market_feed_state (
	id            smallint primary key check (id = 1),
	processed_id  bigint not null default 0,
	updated_at    timestamptz not null default now()
);
insert into event_market_feed_state (id, processed_id)
	values (1, coalesce((select max(id) from event_market_events), 0))
	on conflict (id) do nothing;

create table if not exists event_market_moves (
	id              bigserial primary key,
	market_id       uuid not null references event_markets(id) on delete cascade,
	outcome_id      uuid not null references event_market_outcomes(id) on delete cascade,
	window_bucket   bigint not null,
	share_from      numeric(7,6) not null,
	share_to        numeric(7,6) not null,
	delta_points    numeric(6,2) not null,
	window_seconds  integer not null,
	created_at      timestamptz not null default now(),
	unique (market_id, outcome_id, window_bucket)
);
create index if not exists event_market_moves_recent on event_market_moves(created_at desc);

create or replace function event_market_log_pick() returns trigger as $$
begin
	insert into event_market_events (market_id, kind, payload)
	values (coalesce(new.market_id, old.market_id), 'pick',
	        jsonb_build_object('outcome_id', coalesce(new.outcome_id, old.outcome_id)));
	return null;
end;
$$ language plpgsql;

drop trigger if exists event_market_picks_feed on event_market_picks;
create trigger event_market_picks_feed
	after insert or update or delete on event_market_picks
	for each row execute function event_market_log_pick();

create or replace function event_market_log_status() returns trigger as $$
declare
	k text;
	label text;
begin
	if tg_op = 'INSERT' then
		if new.status <> 'open' then return null; end if;
		k := 'open';
	else
		if new.status is not distinct from old.status then return null; end if;
		k := case new.status
			when 'open' then 'open'
			when 'locked' then 'lock'
			when 'resolved' then 'resolve'
			when 'void' then 'resolve'
			else null end;
		if k is null then return null; end if;
	end if;
	if new.winner_outcome_id is not null then
		select o.label into label from event_market_outcomes o where o.id = new.winner_outcome_id;
	end if;
	insert into event_market_events (market_id, kind, payload)
	values (new.id, k, jsonb_build_object(
		'title', new.title, 'status', new.status, 'locks_at', new.locks_at,
		'winner_outcome_id', new.winner_outcome_id, 'winner_label', label))
	on conflict (market_id, kind) where kind in ('open','lock','resolve') do nothing;
	return null;
end;
$$ language plpgsql;

drop trigger if exists event_markets_feed on event_markets;
create trigger event_markets_feed
	after insert or update of status on event_markets
	for each row execute function event_market_log_status();
