-- xai_usage: one row per metered xAI (Grok) API call. The ledger behind
-- `npm run grok:usage` and the xai_credit subsystem in /api/healthz. The
-- startups credit grant is one balance across chat, image, video, voice,
-- evals and the mention bot; this table is where every lane's spend lands.
-- Fully idempotent.

create table if not exists xai_usage (
    id               bigserial primary key,
    created_at       timestamptz not null default now(),
    lane             text not null,
    model            text not null,
    request_id       text,
    input_tokens     bigint not null default 0,
    output_tokens    bigint not null default 0,
    cached_tokens    bigint not null default 0,
    reasoning_tokens bigint not null default 0,
    units            numeric not null default 0,
    cost_usd_micro   bigint not null default 0,
    cost_source      text not null check (cost_source in ('api', 'price_table')),
    account_id       uuid references users(id) on delete set null,
    meta             jsonb not null default '{}'::jsonb
);

create index if not exists xai_usage_created_at on xai_usage(created_at);
create index if not exists xai_usage_lane_created_at on xai_usage(lane, created_at);
