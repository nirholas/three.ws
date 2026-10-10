-- Perps desk: paper ledger, execution idempotency and alert dedupe.
--
-- Paper mode trades against a venue's live order book and marks while keeping
-- collateral, positions, resting orders, fills and funding in these tables, so
-- an owner can run the full flow before turning live mode on and tests never
-- open a real position. api/_lib/perps/paper.js owns every read and write of
-- the perps_paper_* tables; every mutation commits under the optimistic
-- `version` on perps_paper_accounts with each statement guarded by `op_token`.
--
-- perps_executions makes every execute (deposit, withdraw, order, cancel,
-- flatten) idempotent per agent and Idempotency-Key, in both modes.
-- perps_alert_events dedupes owner alerts (one per kind, symbol and hour).
-- Idempotent.

create table if not exists perps_paper_accounts (
    agent_id          uuid not null references agent_identities(id) on delete cascade,
    venue             text not null,
    user_id           uuid not null references users(id) on delete cascade,
    collateral_usd    numeric(20, 6) not null default 0,
    realized_pnl_usd  numeric(20, 6) not null default 0,
    fees_paid_usd     numeric(20, 6) not null default 0,
    funding_paid_usd  numeric(20, 6) not null default 0,
    deposited_usd     numeric(20, 6) not null default 0,
    withdrawn_usd     numeric(20, 6) not null default 0,
    version           integer not null default 0,
    op_token          uuid,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    primary key (agent_id, venue)
);

create table if not exists perps_paper_positions (
    agent_id          uuid not null references agent_identities(id) on delete cascade,
    venue             text not null,
    symbol            text not null,
    signed_size       numeric(30, 12) not null,
    entry_price       numeric(30, 12) not null,
    funding_paid_usd  numeric(20, 6) not null default 0,
    funding_at        timestamptz not null default now(),
    opened_at         timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    primary key (agent_id, venue, symbol)
);

create table if not exists perps_paper_orders (
    id                bigserial primary key,
    agent_id          uuid not null references agent_identities(id) on delete cascade,
    venue             text not null,
    symbol            text not null,
    type              text not null check (type in ('limit','take_profit','stop_loss')),
    side              text not null check (side in ('long','short')),
    size              numeric(30, 12),
    price             numeric(30, 12),
    trigger_price     numeric(30, 12),
    direction         text check (direction is null or direction in ('greater_than','less_than')),
    size_percent      numeric(6, 2),
    reduce_only       boolean not null default false,
    status            text not null default 'open' check (status in ('open','filled','cancelled')),
    fill_price        numeric(30, 12),
    preview_id        text,
    created_at        timestamptz not null default now(),
    closed_at         timestamptz
);
create index if not exists perps_paper_orders_open
    on perps_paper_orders (agent_id, venue) where status = 'open';

create table if not exists perps_paper_fills (
    id                bigserial primary key,
    agent_id          uuid not null references agent_identities(id) on delete cascade,
    venue             text not null,
    symbol            text not null,
    side              text not null check (side in ('long','short')),
    size              numeric(30, 12) not null,
    price             numeric(30, 12) not null,
    fee_usd           numeric(20, 6) not null default 0,
    realized_pnl_usd  numeric(20, 6) not null default 0,
    reason            text not null
                      check (reason in ('order','limit','take_profit','stop_loss','liquidation','flatten')),
    order_id          bigint,
    preview_id        text,
    created_at        timestamptz not null default now()
);
create index if not exists perps_paper_fills_agent
    on perps_paper_fills (agent_id, venue, id desc);

create table if not exists perps_executions (
    id                bigserial primary key,
    agent_id          uuid not null references agent_identities(id) on delete cascade,
    user_id           uuid not null references users(id) on delete cascade,
    venue             text not null,
    mode              text not null check (mode in ('paper','live')),
    action            text not null check (action in ('deposit','withdraw','order','cancel','flatten')),
    idempotency_key   text not null check (char_length(idempotency_key) between 1 and 200),
    preview_id        text not null,
    status            text not null default 'pending' check (status in ('pending','ok','failed')),
    signatures        text[] not null default '{}',
    result            jsonb,
    error             jsonb,
    source            text,
    created_at        timestamptz not null default now(),
    finished_at       timestamptz,
    unique (agent_id, idempotency_key)
);
create index if not exists perps_executions_agent
    on perps_executions (agent_id, created_at desc);

create table if not exists perps_alert_events (
    id                bigserial primary key,
    agent_id          uuid not null references agent_identities(id) on delete cascade,
    user_id           uuid not null references users(id) on delete cascade,
    mode              text not null check (mode in ('paper','live')),
    kind              text not null,
    symbol            text,
    value             numeric(30, 8),
    threshold         numeric(30, 8),
    dedupe_key        text not null unique,
    created_at        timestamptz not null default now()
);
create index if not exists perps_alert_events_agent
    on perps_alert_events (agent_id, created_at desc);
