-- Migration: DCA strategies, subscription schedules, and pump.fun signals.
-- Apply: psql "$DATABASE_URL" -f api/_lib/migrations/2026-05-01-dca-and-subscriptions.sql
-- Idempotent.

begin;

-- ── agent_subscriptions — recurring on-chain payment schedules ──────────────
create table if not exists agent_subscriptions (
    id                  uuid primary key default gen_random_uuid(),
    user_id             uuid not null references users(id) on delete cascade,
    agent_id            uuid not null references agent_identities(id) on delete cascade,
    delegation_id       uuid not null references agent_delegations(id) on delete cascade,
    period_seconds      integer not null,
    amount_per_period   text not null,
    next_charge_at      timestamptz not null,
    last_charge_at      timestamptz,
    status              text not null default 'active',
    last_error          text,
    created_at          timestamptz not null default now(),
    canceled_at         timestamptz,

    constraint agent_subscriptions_status_check
        check (status in ('active', 'canceled', 'paused')),
    constraint agent_subscriptions_period_seconds_check
        check (period_seconds > 0)
);

create index if not exists idx_subscriptions_due on agent_subscriptions(next_charge_at) where status = 'active';
create index if not exists idx_subscriptions_user on agent_subscriptions(user_id);
create index if not exists idx_subscriptions_agent on agent_subscriptions(agent_id);

-- ── dca_strategies — DCA schedule configs ───────────────────────────────────
create table if not exists dca_strategies (
    id                      uuid primary key default gen_random_uuid(),
    agent_id                uuid not null,
    delegation_id           uuid not null,
    chain_id                integer not null default 84532,
    token_in                text not null,
    token_out               text not null,
    token_out_symbol        text not null default 'WETH',
    amount_per_execution    text not null,
    period_seconds          integer not null,
    slippage_bps            integer not null default 50,
    status                  text not null default 'active',
    next_execution_at       timestamptz not null,
    last_execution_at       timestamptz,
    created_at              timestamptz not null default now(),
    cancelled_at            timestamptz,

    constraint dca_strategies_status_check
        check (status in ('active', 'paused', 'expired', 'cancelled')),
    constraint dca_strategies_chain_id_check
        check (chain_id > 0),
    constraint dca_strategies_slippage_check
        check (slippage_bps between 1 and 500),
    constraint dca_strategies_period_check
        check (period_seconds in (86400, 604800))
);

create index if not exists idx_dca_strategies_agent on dca_strategies(agent_id);
create index if not exists idx_dca_strategies_next_exec on dca_strategies(next_execution_at) where status = 'active';

-- ── dca_executions — per-cron swap attempt log ───────────────────────────────
create table if not exists dca_executions (
    id                      uuid primary key default gen_random_uuid(),
    strategy_id             uuid not null references dca_strategies(id) on delete cascade,
    chain_id                integer not null,
    tx_hash                 text,
    amount_in               text not null,
    quote_amount_out        text,
    amount_out              text,
    slippage_bps_used       integer,
    quote_divergence_bps    integer,
    status                  text not null default 'pending',
    error                   text,
    executed_at             timestamptz not null default now(),

    constraint dca_executions_status_check
        check (status in ('pending', 'success', 'failed', 'aborted'))
);

create index if not exists idx_dca_executions_strategy on dca_executions(strategy_id);

-- ── pumpfun_signals — off-chain pump.fun activity signals ────────────────────
create table if not exists pumpfun_signals (
    id                bigserial primary key,
    wallet            text        not null,
    agent_asset       text,
    kind              text        not null,
    weight            real        not null default 0,
    payload           jsonb       not null default '{}'::jsonb,
    tx_signature      text        unique,
    seen_at           timestamptz not null default now()
);

create index if not exists pumpfun_signals_wallet on pumpfun_signals(wallet, seen_at desc);
create index if not exists pumpfun_signals_agent  on pumpfun_signals(agent_asset, seen_at desc) where agent_asset is not null;
create index if not exists pumpfun_signals_kind   on pumpfun_signals(kind, seen_at desc);

commit;
