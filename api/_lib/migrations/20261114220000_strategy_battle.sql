-- Migration: Backtest Battle, a public 24h paper forward test of Strategy Lab specs.
-- Apply: psql "$DATABASE_URL" -f api/_lib/migrations/20261114220000_strategy_battle.sql
-- Idempotent.
--
-- One round per UTC day (id 'YYYY-MM-DD', 00:00 to 24:00 UTC). A user submits
-- one declarative strategy (examples/skills/pump-fun-strategy DSL) into the
-- NEXT round; it locks when the round starts so every entry trades the same
-- 24 hours. The cron api/cron/strategy-battle-tick.js paper-trades every entry
-- against live pump.fun bonding curves (constant-product fills with the curve
-- fee, never a wallet), and settles the round at its end by marking every open
-- position to a simulated sell and ranking by final equity.
--
-- Nothing in these tables can move a token: there is no wallet column and the
-- engine (api/_lib/strategy-battle.js) never loads a signer.

begin;

create table if not exists strategy_battle_rounds (
    id               text        primary key,              -- 'YYYY-MM-DD' (UTC day)
    starts_at        timestamptz not null,
    ends_at          timestamptz not null,
    status           text        not null default 'open'
                     check (status in ('open', 'running', 'settled')),
    tick_lease_until timestamptz,                          -- overlapping cron ticks skip
    last_tick_at     timestamptz,
    last_tick_stats  jsonb       not null default '{}'::jsonb,
    settled_at       timestamptz,
    created_at       timestamptz not null default now()
);

create table if not exists strategy_battle_entries (
    id                uuid        primary key default gen_random_uuid(),
    round_id          text        not null references strategy_battle_rounds(id) on delete cascade,
    user_id           uuid        not null references users(id) on delete cascade,
    name              text        not null check (char_length(name) between 1 and 60),
    strategy          jsonb       not null,                -- normalized spec actually traded
    strategy_hash     text        not null,
    source            text        not null default 'lab'
                      check (source in ('lab', 'clone', 'fork')),
    source_ref        text,                                -- agent id (clone) or entry id (fork)
    status            text        not null default 'queued'
                      check (status in ('queued', 'running', 'settled', 'withdrawn')),
    bankroll_sol      numeric(20, 9) not null default 1,
    cash_sol          numeric(20, 9) not null default 1,
    equity_sol        numeric(20, 9) not null default 1,
    peak_equity_sol   numeric(20, 9) not null default 1,
    max_drawdown_pct  numeric(10, 4) not null default 0,
    realized_pnl_sol  numeric(20, 9) not null default 0,
    fees_sol          numeric(20, 9) not null default 0,
    trade_count       integer     not null default 0,      -- entries opened
    closed_count      integer     not null default 0,
    win_count         integer     not null default 0,
    evaluated_count   integer     not null default 0,      -- candidates checked against filters
    skipped_data      integer     not null default 0,      -- a filter's metric had no live source
    last_tick_at      timestamptz,
    final_rank        integer,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    unique (round_id, user_id)
);

create index if not exists strategy_battle_entries_round
    on strategy_battle_entries (round_id, status);

create table if not exists strategy_battle_positions (
    id               uuid        primary key default gen_random_uuid(),
    entry_id         uuid        not null references strategy_battle_entries(id) on delete cascade,
    mint             text        not null,
    symbol           text,
    status           text        not null default 'open' check (status in ('open', 'closed')),
    cost_sol         numeric(20, 9) not null,              -- SOL spent including the buy fee
    amount_tokens    numeric(30, 6) not null,
    entry_price_sol  numeric(30, 18) not null,             -- spot price on the curve at entry
    token_supply     numeric(30, 0),                       -- raw supply, for market cap in exit views
    token_decimals   integer,
    launched_at      timestamptz,
    last_price_sol   numeric(30, 18),
    last_value_sol   numeric(20, 9),                       -- simulated sell proceeds at last mark
    exit_price_sol   numeric(30, 18),
    proceeds_sol     numeric(20, 9),
    pnl_sol          numeric(20, 9),
    exit_reason      text,
    opened_at        timestamptz not null default now(),
    closed_at        timestamptz,
    unique (entry_id, mint)
);

create index if not exists strategy_battle_positions_open
    on strategy_battle_positions (entry_id) where status = 'open';

commit;
