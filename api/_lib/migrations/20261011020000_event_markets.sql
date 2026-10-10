-- Event Markets core: free-to-play "who wins this event?" markets.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261011020000_event_markets.sql
-- Idempotent. Picks carry points, not funds. The pick log is append-only and is
-- the source of the odds history. Later migrations extend event_market_picks
-- (agent forecasting) and add scoring, referrals and resolution columns.

create table if not exists event_markets (
	id                  uuid primary key default gen_random_uuid(),
	slug                text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$'),
	title               text not null check (char_length(title) between 3 and 200),
	description         text,
	source_kind         text not null check (source_kind in ('arena_tournament','event_leaderboard','launch_cohort','build_round','bounty','custom')),
	source_ref          text,
	status              text not null default 'open' check (status in ('draft','open','locked','resolved','void')),
	opens_at            timestamptz not null default now(),
	locks_at            timestamptz not null,
	resolves_at         timestamptz,
	resolved_at         timestamptz,
	resolution_rule     jsonb not null default '{}'::jsonb,
	winner_outcome_id   uuid,
	void_reason         text,
	created_by          uuid references users(id) on delete set null,
	created_at          timestamptz not null default now(),
	updated_at          timestamptz not null default now(),
	check (locks_at > opens_at)
);
create unique index if not exists event_markets_source_once on event_markets(source_kind, source_ref) where source_ref is not null;
create index if not exists event_markets_status_locks on event_markets(status, locks_at);

create table if not exists event_market_outcomes (
	id          uuid primary key default gen_random_uuid(),
	market_id   uuid not null references event_markets(id) on delete cascade,
	label       text not null check (char_length(label) between 1 and 120),
	ref_kind    text,
	ref_id      text,
	image_url   text,
	position    integer not null default 0,
	created_at  timestamptz not null default now()
);
create index if not exists event_market_outcomes_market on event_market_outcomes(market_id, position);

do $$ begin
	alter table event_markets add constraint event_markets_winner_fk
		foreign key (winner_outcome_id) references event_market_outcomes(id) on delete set null;
exception when duplicate_object then null; end $$;

create table if not exists event_market_picks (
	id             uuid primary key default gen_random_uuid(),
	market_id      uuid not null references event_markets(id) on delete cascade,
	outcome_id     uuid not null references event_market_outcomes(id) on delete cascade,
	account_id     uuid not null references users(id) on delete cascade,
	points         integer not null check (points > 0),
	status         text not null default 'live' check (status in ('live','refunded')),
	odds_at_pick   numeric,
	ranked         boolean not null default true,
	agent_id       uuid,
	created_at     timestamptz not null default now(),
	updated_at     timestamptz not null default now()
);
-- One live pick per human account per market. Agent picks (agent_id set) are
-- keyed per agent by the agent-forecasting migration.
create unique index if not exists event_market_picks_human_one on event_market_picks(market_id, account_id) where agent_id is null;
do $$ begin
	if to_regclass('agent_identities') is not null then
		alter table event_market_picks add constraint event_market_picks_agent_fk
			foreign key (agent_id) references agent_identities(id) on delete cascade;
	end if;
exception when duplicate_object then null; end $$;
create index if not exists event_market_picks_account on event_market_picks(account_id, status);
create index if not exists event_market_picks_outcome on event_market_picks(outcome_id);

create table if not exists event_market_pick_log (
	id          bigserial primary key,
	market_id   uuid not null references event_markets(id) on delete cascade,
	outcome_id  uuid not null,
	account_id  uuid not null,
	points      integer not null,
	action      text not null check (action in ('place','change','withdraw','void')),
	created_at  timestamptz not null default now()
);
create index if not exists event_market_pick_log_market on event_market_pick_log(market_id, id);
