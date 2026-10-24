-- Migration: builder competition registrations.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261023200000_competition_entries.sql
-- Idempotent.
--
-- The competitions themselves (dates, tracks, prizes, judges, rules) live in
-- data/competitions.json, not in the database. This table only holds who
-- entered: one row per agent per competition. A tokenized entry is derived at
-- read time from pump_agent_mints, so nothing here is copied from launch data.

begin;

create table if not exists competition_entries (
    id            uuid primary key default gen_random_uuid(),
    competition   text not null,
    user_id       uuid not null references users(id) on delete cascade,
    agent_id      uuid not null references agent_identities(id) on delete cascade,
    team_name     text,
    x_handle      text,
    track         text,
    created_at    timestamptz not null default now(),
    unique (competition, agent_id)
);

create index if not exists competition_entries_comp_idx on competition_entries (competition, created_at);
create index if not exists competition_entries_user_idx on competition_entries (user_id);

commit;
