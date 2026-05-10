-- Migration: canonical skill_purchases table.
-- Apply: psql "$DATABASE_URL" -f api/_lib/migrations/2026-05-10-skill-purchases.sql
-- Idempotent.
--
-- Replaces the never-deployed skill_purchases / user_skill_purchases that were
-- referenced by code but never created. Aligns column names with the deployed
-- agent_skill_prices schema (column "skill", not "skill_name" or "skill_id").
--
-- State machine:
--   pending   — buyer fetched Solana Pay params; no on-chain confirmation yet
--   confirmed — reference observed on-chain, payment to creator wallet matched
--   failed    — explicit rejection (refunded, expired, malformed)

begin;

create table if not exists skill_purchases (
    id            uuid primary key default gen_random_uuid(),
    user_id       uuid not null references users(id) on delete cascade,
    agent_id      uuid not null references agent_identities(id) on delete cascade,
    skill         text not null,
    status        text not null default 'pending'
                    check (status in ('pending', 'confirmed', 'failed')),
    reference     text not null unique,
    tx_signature  text unique,
    amount        bigint not null,
    currency_mint text not null,
    chain         text not null default 'solana',
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    confirmed_at  timestamptz
);

-- A user holds at most one confirmed purchase for a given (agent, skill);
-- multiple pending/failed attempts are allowed.
create unique index if not exists skill_purchases_one_confirmed_per_user
    on skill_purchases (user_id, agent_id, skill)
    where status = 'confirmed';

create index if not exists skill_purchases_user_agent
    on skill_purchases (user_id, agent_id);

create index if not exists skill_purchases_agent
    on skill_purchases (agent_id);

create index if not exists skill_purchases_status_created
    on skill_purchases (status, created_at desc);

-- Auto-bump updated_at; reuse the standard set_updated_at trigger function.
do $$ begin
    create trigger skill_purchases_set_updated_at before update on skill_purchases
        for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;

commit;
