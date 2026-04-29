-- Migration: pump.fun integration tables.
-- Apply: psql "$DATABASE_URL" -f api/_lib/migrations/2026-04-30-pump-fun.sql
-- Idempotent.

begin;

-- ── pump_agent_mints ────────────────────────────────────────────────────────
-- One row per agent that has a paired pump.fun token + agent-payments PDA.
create table if not exists pump_agent_mints (
    id              uuid primary key default gen_random_uuid(),
    agent_id        uuid not null references agent_identities(id) on delete cascade,
    user_id         uuid not null references users(id) on delete cascade,
    network         text not null check (network in ('mainnet','devnet')),
    mint            text not null,                  -- spl mint pubkey (base58)
    name            text,
    symbol          text,
    metadata_uri    text,
    agent_authority text,                            -- pubkey that can withdraw / update
    buyback_bps     int  not null default 0 check (buyback_bps between 0 and 10000),
    pump_agent_pda  text,                            -- token-agent-payments PDA (base58)
    sharing_config  jsonb not null default '{}'::jsonb,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);
create unique index if not exists pump_agent_mints_mint_uniq
    on pump_agent_mints(mint, network);
create index if not exists pump_agent_mints_agent
    on pump_agent_mints(agent_id);

-- ── pump_agent_payments ─────────────────────────────────────────────────────
-- Off-chain audit trail for every acceptPayment we built. The on-chain
-- TokenAgentPaymentInCurrency PDA is the canonical receipt; this table is
-- just the local index for fast UI / reputation queries.
create table if not exists pump_agent_payments (
    id              uuid primary key default gen_random_uuid(),
    mint_id         uuid not null references pump_agent_mints(id) on delete cascade,
    user_id         uuid references users(id) on delete set null, -- payer (if known)
    payer_wallet    text not null,
    currency_mint   text not null,
    amount_atomics  numeric(40, 0) not null,
    invoice_id      numeric(40, 0) not null,                       -- BN memo
    invoice_pda     text,
    start_time      timestamptz,
    end_time        timestamptz,
    tx_signature    text,
    status          text not null default 'pending' check (status in ('pending','confirmed','failed','expired')),
    skill_id        text,                                          -- optional: which paid skill
    tool_name       text,                                          -- optional: which MCP tool
    created_at      timestamptz not null default now(),
    confirmed_at    timestamptz
);
create index if not exists pump_agent_payments_mint
    on pump_agent_payments(mint_id);
create index if not exists pump_agent_payments_invoice
    on pump_agent_payments(mint_id, invoice_id);
create index if not exists pump_agent_payments_status_pending
    on pump_agent_payments(status) where status = 'pending';

-- ── pump_distribute_runs ────────────────────────────────────────────────────
-- Record of every distributePayments cron call (permissionless, so we just log
-- what we attempted and what the resulting balances were).
create table if not exists pump_distribute_runs (
    id              uuid primary key default gen_random_uuid(),
    mint_id         uuid not null references pump_agent_mints(id) on delete cascade,
    currency_mint   text not null,
    tx_signature    text,
    status          text not null default 'pending' check (status in ('pending','confirmed','failed','skipped')),
    balances_before jsonb,
    balances_after  jsonb,
    error           text,
    created_at      timestamptz not null default now()
);
create index if not exists pump_distribute_runs_mint
    on pump_distribute_runs(mint_id, created_at desc);

-- ── pump_buyback_runs ───────────────────────────────────────────────────────
create table if not exists pump_buyback_runs (
    id              uuid primary key default gen_random_uuid(),
    mint_id         uuid not null references pump_agent_mints(id) on delete cascade,
    currency_mint   text not null,
    swap_program    text,
    tx_signature    text,
    burn_amount     numeric(40, 0),
    status          text not null default 'pending' check (status in ('pending','confirmed','failed','skipped')),
    error           text,
    created_at      timestamptz not null default now()
);
create index if not exists pump_buyback_runs_mint
    on pump_buyback_runs(mint_id, created_at desc);

commit;
