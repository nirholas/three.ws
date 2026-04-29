-- Migration: per-mint price-point time series.
-- Apply: psql "$DATABASE_URL" -f api/_lib/migrations/2026-04-29-pump-price-points.sql
-- Idempotent.
--
-- Writers: api/cron/pump-agent-stats.js
-- Readers: api/agents/solana-price-history.js

begin;

create table if not exists pump_agent_price_points (
    id              bigserial primary key,
    mint_id         uuid not null references pump_agent_mints(id) on delete cascade,
    ts              timestamptz not null default now(),
    sol_per_token   double precision,
    market_cap_lamports numeric(40, 0),
    source          text not null check (source in ('bonding_curve','amm','none'))
);
create index if not exists pump_agent_price_points_mint_ts
    on pump_agent_price_points(mint_id, ts desc);

commit;
