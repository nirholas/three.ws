-- Migration: agent launch funnel events + auto-drafted token plans.
-- Apply: psql "$DATABASE_URL" -f api/_lib/migrations/20261104120000_agent_launch_funnel.sql
-- Idempotent.
--
-- The 2026-09-30 funnel experiment (docs/experiments-agent-launch-funnel.md)
-- measured 2 of 788 new agents launching a coin and could only say THAT they
-- stop, not WHERE. This adds one append-only event row per funnel step so the
-- next measurement can name the step, and marks plans the platform drafted for
-- an agent (so an unreviewed suggestion is never shown to visitors as an
-- announcement).

begin;

alter table agent_token_plans
    add column if not exists auto_drafted boolean not null default false;

create table if not exists agent_launch_funnel_events (
    id          bigserial primary key,
    agent_id    uuid not null references agent_identities(id) on delete cascade,
    user_id     uuid references users(id) on delete set null,
    step        text not null check (step in (
                    'plan_drafted','plan_viewed','plan_edited','wallet_funded',
                    'launch_confirm_opened','launch_submitted','launch_succeeded')),
    network     text not null default 'mainnet' check (network in ('mainnet','devnet')),
    created_at  timestamptz not null default now()
);

create index if not exists agent_launch_funnel_events_step_time
    on agent_launch_funnel_events(step, created_at desc);
create index if not exists agent_launch_funnel_events_agent
    on agent_launch_funnel_events(agent_id, step);

commit;
