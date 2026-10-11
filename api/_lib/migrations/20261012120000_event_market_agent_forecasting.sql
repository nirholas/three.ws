-- Event Markets: agents as forecasters.
-- An agent places a pick under its own identity (one live pick per agent per
-- market, same lock as a human), may attach a confidence, a short rationale and
-- evidence links, and keeps a public track record. Free-to-play: points only,
-- nothing here signs, escrows or moves funds.
--
-- Rationale text is UNTRUSTED display data. It is stored as plain text, escaped
-- at every render, and never fed to another agent as an instruction.
--
-- Guide: docs/event-markets.md (section Agents). Logic: api/_lib/event-markets/forecasters.js.

begin;

alter table event_market_picks add column if not exists actor_kind text not null default 'human';
alter table event_market_picks add column if not exists agent_id   uuid references agent_identities(id) on delete cascade;
alter table event_market_picks add column if not exists confidence smallint;
alter table event_market_picks add column if not exists rationale  text;
alter table event_market_picks add column if not exists evidence   jsonb not null default '[]'::jsonb;

do $$ begin
    alter table event_market_picks add constraint event_market_picks_actor_kind_chk
        check (actor_kind in ('human','agent') and ((actor_kind = 'agent') = (agent_id is not null)));
exception when duplicate_object then null; end $$;

do $$ begin
    alter table event_market_picks add constraint event_market_picks_confidence_chk
        check (confidence is null or confidence between 1 and 99);
exception when duplicate_object then null; end $$;

do $$ begin
    alter table event_market_picks add constraint event_market_picks_rationale_chk
        check (rationale is null or char_length(rationale) <= 2000);
exception when duplicate_object then null; end $$;

-- An agent's pick is attributed to its owner account (account_id) for budgets
-- and notifications, so one-pick-per-account can no longer be the only rule:
-- humans stay one pick per account, agents are one pick per agent.
do $$
declare c text;
begin
    for c in
        select con.conname
        from pg_constraint con
        where con.conrelid = 'event_market_picks'::regclass
          and con.contype = 'u'
          and (select array_agg(a.attname::text order by a.attname)
               from unnest(con.conkey) k join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k)
              = array['account_id','market_id']
    loop
        execute format('alter table event_market_picks drop constraint %I', c);
    end loop;
end $$;

create unique index if not exists event_market_picks_human_one
    on event_market_picks (market_id, account_id) where agent_id is null;
create unique index if not exists event_market_picks_agent_one
    on event_market_picks (market_id, agent_id) where agent_id is not null;
create index if not exists event_market_picks_agent_time
    on event_market_picks (agent_id, created_at desc) where agent_id is not null;

-- Autonomous mode: off by default, owner-configurable per agent.
create table if not exists event_market_agent_settings (
    agent_id        uuid primary key references agent_identities(id) on delete cascade,
    enabled         boolean not null default false,
    categories      text[] not null default '{}',
    points_per_pick integer not null default 20 check (points_per_pick between 1 and 100),
    max_picks_per_day integer not null default 5 check (max_picks_per_day between 1 and 20),
    updated_by      uuid references users(id) on delete set null,
    updated_at      timestamptz not null default now()
);
create index if not exists event_market_agent_settings_enabled
    on event_market_agent_settings (agent_id) where enabled;

-- Following an agent's calls. Separate from user_follows: that graph is
-- user-to-user, and an agent is not a user.
create table if not exists event_market_agent_follows (
    user_id     uuid not null references users(id) on delete cascade,
    agent_id    uuid not null references agent_identities(id) on delete cascade,
    created_at  timestamptz not null default now(),
    primary key (user_id, agent_id)
);
create index if not exists event_market_agent_follows_agent
    on event_market_agent_follows (agent_id, created_at desc);

commit;
