-- Event Markets core: free-to-play prediction markets over our own events.
-- Points only. Nothing here signs, escrows or moves funds.
--
--   event_markets          one market per event, a state machine over `status`
--   event_market_outcomes  the entrants a pick can back (agent, wallet, project, team)
--   event_market_picks     one live pick per account per market
--   event_market_pick_log  append-only record of every place/change/withdraw/void
--
-- Later event_market_* migrations add columns and indexes with if not exists, so
-- re-running this file is safe. Logic: api/_lib/event-markets/index.js.

begin;

create table if not exists event_markets (
	id              uuid primary key default gen_random_uuid(),
	slug            text not null unique,
	title           text not null,
	description     text,
	source_kind     text not null,
	source_ref      text,
	status          text not null default 'open',
	opens_at        timestamptz not null default now(),
	locks_at        timestamptz not null,
	resolves_at     timestamptz,
	resolution_rule jsonb not null default '{}'::jsonb,
	winner_outcome_id uuid,
	void_reason     text,
	created_by      uuid references users(id) on delete set null,
	created_at      timestamptz not null default now(),
	updated_at      timestamptz not null default now(),
	constraint event_markets_status_chk check (status in ('draft','open','locked','resolved','void')),
	constraint event_markets_source_kind_chk check (source_kind in ('arena_tournament','event_leaderboard','launch_cohort','build_round','bounty','custom'))
);
create index if not exists event_markets_status_locks on event_markets (status, locks_at);

create table if not exists event_market_outcomes (
	id         uuid primary key default gen_random_uuid(),
	market_id  uuid not null references event_markets(id) on delete cascade,
	label      text not null,
	ref_kind   text,
	ref_id     text,
	image_url  text,
	position   integer not null default 0,
	created_at timestamptz not null default now(),
	constraint event_market_outcomes_ref_kind_chk check (ref_kind is null or ref_kind in ('agent','wallet','project','team'))
);
create index if not exists event_market_outcomes_market on event_market_outcomes (market_id, position);

do $$ begin
	alter table event_markets add constraint event_markets_winner_fk
		foreign key (winner_outcome_id) references event_market_outcomes(id) on delete set null;
exception when duplicate_object then null;
end $$;

create table if not exists event_market_picks (
	id         uuid primary key default gen_random_uuid(),
	market_id  uuid not null references event_markets(id) on delete cascade,
	outcome_id uuid not null references event_market_outcomes(id) on delete cascade,
	account_id uuid not null references users(id) on delete cascade,
	points     integer not null check (points > 0),
	status     text not null default 'live',
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint event_market_picks_status_chk check (status in ('live','won','lost','refunded')),
	unique (market_id, account_id)
);
create index if not exists event_market_picks_outcome on event_market_picks (outcome_id);
create index if not exists event_market_picks_account on event_market_picks (account_id, created_at desc);

create table if not exists event_market_pick_log (
	id         bigserial primary key,
	market_id  uuid not null references event_markets(id) on delete cascade,
	outcome_id uuid not null references event_market_outcomes(id) on delete cascade,
	account_id uuid not null references users(id) on delete cascade,
	points     integer not null,
	action     text not null check (action in ('place','change','withdraw','void')),
	created_at timestamptz not null default now()
);
create index if not exists event_market_pick_log_market on event_market_pick_log (market_id, id);

commit;
