-- Migration: follow a trader, and get pushed when they go on a hot streak.
-- Apply: psql "$DATABASE_URL" -f api/_lib/migrations/20261114210000_trader_follows_hot_streak.sql
-- Idempotent.
--
-- trader_follows is the user -> trader edge behind the Follow button on
-- /trader/:id. It is separate from user_follows (people) and from
-- copy_subscriptions / agent_mirror_follows (money): following a trader costs
-- nothing and only means "tell me when they are on a hot streak".
--
-- trader_streak_events makes the push idempotent. One row per
-- (agent, network, position that completed the milestone), so a cron re-run, an
-- overlapping tick or a retry after a crash can never announce a streak twice.
-- claimed_at is the lease: a tick claims an event, notifies, then stamps
-- notified_at; a crashed tick leaves notified_at null and a later tick may
-- re-claim it once the lease has expired.

begin;

create table if not exists trader_follows (
    user_id    uuid        not null references users(id) on delete cascade,
    agent_id   uuid        not null references agent_identities(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (user_id, agent_id)
);

create index if not exists trader_follows_agent
    on trader_follows (agent_id);

create table if not exists trader_streak_events (
    id                  uuid        primary key default gen_random_uuid(),
    agent_id            uuid        not null references agent_identities(id) on delete cascade,
    network             text        not null default 'mainnet' check (network in ('mainnet','devnet')),
    streak_len          int         not null check (streak_len > 0),
    trigger_position_id uuid        not null,           -- agent_sniper_positions.id of the close that made the streak
    closed_at           timestamptz not null,           -- when that position closed
    claimed_at          timestamptz not null default now(),
    notified_at         timestamptz,
    recipients          int         not null default 0,
    created_at          timestamptz not null default now(),
    unique (agent_id, network, trigger_position_id)
);

create index if not exists trader_streak_events_recent
    on trader_streak_events (created_at desc);

commit;
