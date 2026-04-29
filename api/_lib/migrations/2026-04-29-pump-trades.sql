-- Migration: pump.fun trade audit table.
-- Apply: psql "$DATABASE_URL" -f api/_lib/migrations/2026-04-29-pump-trades.sql
-- Idempotent.
--
-- Writers: api/pump/buy-confirm.js, api/pump/sell-confirm.js
-- Readers: api/agents/solana-reputation.js, dashboards

begin;

create table if not exists pump_agent_trades (
    id              uuid primary key default gen_random_uuid(),
    mint_id         uuid not null references pump_agent_mints(id) on delete cascade,
    user_id         uuid references users(id) on delete set null,
    wallet          text not null,
    direction       text not null check (direction in ('buy','sell')),
    route           text not null check (route in ('bonding_curve','amm')),
    sol_amount      numeric(40, 0),  -- lamports (signed: + for buy spend, sell proceeds)
    token_amount    numeric(40, 0),  -- base units
    slippage_bps    int,
    tx_signature    text not null,
    network         text not null check (network in ('mainnet','devnet')),
    created_at      timestamptz not null default now(),
    unique (tx_signature, network)
);
create index if not exists pump_agent_trades_mint on pump_agent_trades(mint_id, created_at desc);
create index if not exists pump_agent_trades_wallet on pump_agent_trades(wallet);
create index if not exists pump_agent_trades_direction on pump_agent_trades(mint_id, direction);

commit;
