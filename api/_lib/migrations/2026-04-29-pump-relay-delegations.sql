-- Migration: hot-wallet relayer delegation table.
-- Apply: psql "$DATABASE_URL" -f api/_lib/migrations/2026-04-29-pump-relay-delegations.sql
-- Idempotent.
--
-- A row authorizes the server-held PUMP_RELAYER pubkey to execute pump.fun
-- buys/sells on behalf of a user up to (max_sol_lamports cumulative spend)
-- and (expires_at). The user signs an off-chain SIWS message granting this;
-- /api/pump/relay-authorize records the row.
--
-- Writers: api/pump/relay-authorize.js, api/pump/relay-revoke.js
-- Readers: api/pump/relay-trade.js

begin;

create table if not exists pump_trade_delegations (
    id                 uuid primary key default gen_random_uuid(),
    user_id            uuid not null references users(id) on delete cascade,
    agent_id           uuid references agent_identities(id) on delete cascade,
    relayer_pubkey     text not null,
    user_wallet        text not null,                       -- the wallet that signed the SIWS authz
    max_sol_lamports   numeric(40, 0) not null default 0,    -- cumulative cap across all trades
    spent_sol_lamports numeric(40, 0) not null default 0,
    direction_filter   text check (direction_filter in ('buy','sell','both')) default 'both',
    mint_filter        text,                                  -- optional: lock to a single mint
    network            text not null check (network in ('mainnet','devnet')),
    expires_at         timestamptz not null,
    revoked_at         timestamptz,
    created_at         timestamptz not null default now(),
    siws_signature     text                                   -- proof of authz (base58)
);
create index if not exists pump_trade_delegations_user on pump_trade_delegations(user_id);
create index if not exists pump_trade_delegations_active
    on pump_trade_delegations(user_id, agent_id)
    where revoked_at is null;

create table if not exists pump_relay_trades (
    id              uuid primary key default gen_random_uuid(),
    delegation_id   uuid not null references pump_trade_delegations(id) on delete cascade,
    direction       text not null check (direction in ('buy','sell')),
    mint            text not null,
    network         text not null check (network in ('mainnet','devnet')),
    route           text not null check (route in ('bonding_curve','amm')),
    sol_lamports    numeric(40, 0),
    token_amount    numeric(40, 0),
    tx_signature    text not null,
    created_at      timestamptz not null default now(),
    unique (tx_signature, network)
);
create index if not exists pump_relay_trades_delegation
    on pump_relay_trades(delegation_id, created_at desc);

commit;
