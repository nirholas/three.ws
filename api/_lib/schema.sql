-- ─────────────────────────────────────────────────────────────────────────────
-- 3D Agent — Postgres schema (Neon)
-- Idempotent migrations. Apply with:  psql "$DATABASE_URL" -f api/_lib/schema.sql
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- ── users ───────────────────────────────────────────────────────────────────
create table if not exists users (
    id              uuid primary key default gen_random_uuid(),
    email           citext not null unique,
    password_hash   text,                       -- null = oauth-only or wallet-only account
    display_name    text,
    avatar_url      text,
    plan            text not null default 'free' check (plan in ('free','pro','team','enterprise')),
    email_verified  boolean not null default false,
    wallet_address  text,                       -- lowercased 0x… for wallet login
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    deleted_at      timestamptz
);

-- Additive migration for deployments that pre-date the wallet_address column.
alter table users add column if not exists wallet_address text;
create unique index if not exists users_wallet_unique on users(wallet_address) where wallet_address is not null;

-- ── avatars (GLBs stored in R2) ─────────────────────────────────────────────
create table if not exists avatars (
    id              uuid primary key default gen_random_uuid(),
    owner_id        uuid not null references users(id) on delete cascade,
    slug            text not null,              -- short, URL-safe handle
    name            text not null,
    description     text,
    storage_key     text not null,              -- R2 object key
    size_bytes      bigint not null,
    content_type    text not null default 'model/gltf-binary',
    source          text not null default 'upload' check (source in ('upload','avaturn','import')),
    source_meta     jsonb not null default '{}'::jsonb,
    thumbnail_key   text,
    visibility      text not null default 'private' check (visibility in ('private','unlisted','public')),
    tags            text[] not null default '{}',
    checksum_sha256 text,
    version         int not null default 1,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    deleted_at      timestamptz,
    unique (owner_id, slug)
);

create index if not exists avatars_owner_idx on avatars(owner_id) where deleted_at is null;
create index if not exists avatars_public_idx on avatars(visibility, created_at desc) where visibility = 'public' and deleted_at is null;
create index if not exists avatars_tags_idx on avatars using gin(tags);

-- Additive migrations for avatars columns added after initial deployment.
alter table avatars add column if not exists storage_mode jsonb;

-- ── OAuth 2.1 clients (for MCP & third-party apps) ──────────────────────────
-- Supports RFC 7591 dynamic client registration.
create table if not exists oauth_clients (
    id                      uuid primary key default gen_random_uuid(),
    client_id               text not null unique,
    client_secret_hash      text,                            -- null = public client
    client_type             text not null check (client_type in ('public','confidential')),
    name                    text not null,
    logo_uri                text,
    client_uri              text,
    redirect_uris           text[] not null,
    grant_types             text[] not null default '{authorization_code,refresh_token}',
    response_types          text[] not null default '{code}',
    token_endpoint_auth     text not null default 'none',    -- 'none' | 'client_secret_basic' | 'client_secret_post'
    scope                   text not null default 'avatars:read',
    software_id             text,
    software_version        text,
    registered_by_user_id   uuid references users(id) on delete set null,
    dynamically_registered  boolean not null default false,
    created_at              timestamptz not null default now(),
    updated_at              timestamptz not null default now()
);

-- ── OAuth authorization codes (short-lived, PKCE) ───────────────────────────
create table if not exists oauth_auth_codes (
    code                text primary key,                    -- opaque, hashed-at-rest not needed (short TTL)
    client_id           text not null references oauth_clients(client_id) on delete cascade,
    user_id             uuid not null references users(id) on delete cascade,
    redirect_uri        text not null,
    scope               text not null,
    resource            text,                                -- RFC 8707 resource indicator
    code_challenge      text not null,
    code_challenge_method text not null default 'S256',
    expires_at          timestamptz not null,
    consumed_at         timestamptz,
    created_at          timestamptz not null default now()
);

create index if not exists oauth_auth_codes_expiry on oauth_auth_codes(expires_at);

-- ── OAuth refresh tokens ────────────────────────────────────────────────────
-- Access tokens are JWTs (stateless); refresh tokens are opaque + stored.
create table if not exists oauth_refresh_tokens (
    id              uuid primary key default gen_random_uuid(),
    token_hash      text not null unique,                    -- sha256 of the secret
    client_id       text not null references oauth_clients(client_id) on delete cascade,
    user_id         uuid not null references users(id) on delete cascade,
    scope           text not null,
    resource        text,
    expires_at      timestamptz not null,
    revoked_at      timestamptz,
    replaced_by     uuid references oauth_refresh_tokens(id),
    created_at      timestamptz not null default now(),
    last_used_at    timestamptz
);

create index if not exists oauth_refresh_user on oauth_refresh_tokens(user_id) where revoked_at is null;
create index if not exists oauth_refresh_expiry on oauth_refresh_tokens(expires_at);

-- ── Developer API keys (for server-to-server MCP usage) ─────────────────────
create table if not exists api_keys (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid not null references users(id) on delete cascade,
    name            text not null,
    prefix          text not null,                           -- first 8 chars, for display
    token_hash      text not null unique,                    -- sha256(rest)
    scope           text not null default 'avatars:read avatars:write',
    last_used_at    timestamptz,
    expires_at      timestamptz,
    revoked_at      timestamptz,
    created_at      timestamptz not null default now()
);

create index if not exists api_keys_user on api_keys(user_id) where revoked_at is null;

-- ── SIWE (Sign-In with Ethereum) ────────────────────────────────────────────
-- Short-lived nonces issued per client; burned on verify to prevent replay.
create table if not exists siwe_nonces (
    nonce        text primary key,
    address      text,                       -- lowercased, set on verify attempt (audit only)
    issued_at    timestamptz not null default now(),
    expires_at   timestamptz not null,
    consumed_at  timestamptz
);

create index if not exists siwe_nonces_expiry on siwe_nonces(expires_at);

-- Link ethereum addresses to users. A user may have multiple wallets; address is unique.
create table if not exists user_wallets (
    id           uuid primary key default gen_random_uuid(),
    user_id      uuid not null references users(id) on delete cascade,
    address      text not null unique,       -- lowercased 0x-prefixed
    chain_id     int,
    is_primary   boolean not null default false,
    created_at   timestamptz not null default now(),
    last_used_at timestamptz
);

create index if not exists user_wallets_user on user_wallets(user_id);

-- ── Sessions (browser cookie auth) ──────────────────────────────────────────
create table if not exists sessions (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid not null references users(id) on delete cascade,
    token_hash      text not null unique,
    user_agent      text,
    ip              inet,
    expires_at      timestamptz not null,
    revoked_at      timestamptz,
    created_at      timestamptz not null default now(),
    last_seen_at    timestamptz not null default now()
);

create index if not exists sessions_user on sessions(user_id) where revoked_at is null;
create index if not exists sessions_expiry on sessions(expires_at);

-- ── Usage events (for quotas, analytics, billing) ───────────────────────────
create table if not exists usage_events (
    id              bigserial primary key,
    user_id         uuid references users(id) on delete set null,
    api_key_id      uuid references api_keys(id) on delete set null,
    client_id       text references oauth_clients(client_id) on delete set null,
    avatar_id       uuid references avatars(id) on delete set null,
    kind            text not null,                           -- 'tool_call' | 'avatar_fetch' | 'upload' | 'render'
    tool            text,                                    -- MCP tool name if applicable
    status          text not null default 'ok',              -- 'ok' | 'error' | 'rate_limited'
    bytes           bigint,
    latency_ms      int,
    meta            jsonb not null default '{}'::jsonb,
    created_at      timestamptz not null default now()
);

create index if not exists usage_events_user_time on usage_events(user_id, created_at desc);
create index if not exists usage_events_kind_time on usage_events(kind, created_at desc);

-- ── Plan quotas (soft reference; actual limits enforced in code) ────────────
create table if not exists plan_quotas (
    plan                text primary key,
    max_avatars         int not null,
    max_bytes_per_avatar bigint not null,
    max_total_bytes     bigint not null,
    mcp_calls_per_day   int not null,
    updated_at          timestamptz not null default now()
);

insert into plan_quotas (plan, max_avatars, max_bytes_per_avatar, max_total_bytes, mcp_calls_per_day) values
    ('free',         10,   26214400,       262144000,          1000),
    ('pro',          500,  52428800,       26843545600,        50000),
    ('team',         5000, 104857600,      536870912000,       500000),
    ('enterprise',   100000, 524288000,    10995116277760,     10000000)
on conflict (plan) do update set
    max_avatars = excluded.max_avatars,
    max_bytes_per_avatar = excluded.max_bytes_per_avatar,
    max_total_bytes = excluded.max_total_bytes,
    mcp_calls_per_day = excluded.mcp_calls_per_day,
    updated_at = now();

-- ── updated_at triggers ─────────────────────────────────────────────────────
create or replace function set_updated_at() returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

do $$ begin
    create trigger users_set_updated_at before update on users
        for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
    create trigger avatars_set_updated_at before update on avatars
        for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
    create trigger oauth_clients_set_updated_at before update on oauth_clients
        for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;

-- ── agent_identities — every agent gets a body, a place, an identity ─────────
create table if not exists agent_identities (
    id               uuid primary key default gen_random_uuid(),
    user_id          uuid not null references users(id) on delete cascade,
    name             text not null,
    description      text,
    avatar_id        uuid references avatars(id) on delete set null,
    home_url         text,                           -- /agent/:id
    wallet_address   text,
    chain_id         int,
    erc8004_agent_id bigint,
    erc8004_registry text,
    registration_cid text,
    skills           text[] not null default '{}',
    meta             jsonb not null default '{}'::jsonb,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    deleted_at       timestamptz
);

create index if not exists agent_identities_user
    on agent_identities(user_id) where deleted_at is null;
create unique index if not exists agent_identities_user_unique
    on agent_identities(user_id) where deleted_at is null;
create index if not exists agent_identities_wallet
    on agent_identities(wallet_address) where wallet_address is not null;

-- Additive migrations for agent_identities columns added after initial deployment.
alter table agent_identities add column if not exists wallet_address   text;
alter table agent_identities add column if not exists chain_id         int;
alter table agent_identities add column if not exists erc8004_agent_id bigint;
alter table agent_identities add column if not exists erc8004_registry text;
alter table agent_identities add column if not exists registration_cid text;
alter table agent_identities add column if not exists home_url         text;
alter table agent_identities add column if not exists embed_policy     jsonb;

-- ── agent_memories — the agent's persistent context ──────────────────────────
create table if not exists agent_memories (
    id          uuid primary key default gen_random_uuid(),
    agent_id    uuid not null references agent_identities(id) on delete cascade,
    type        text not null check (type in ('user','feedback','project','reference')),
    content     text not null,
    tags        text[] not null default '{}',
    context     jsonb not null default '{}'::jsonb,
    salience    real not null default 0.5,
    created_at  timestamptz not null default now(),
    expires_at  timestamptz
);

create index if not exists agent_memories_agent_type
    on agent_memories(agent_id, type, created_at desc)
    where expires_at is null;

-- ── agent_actions — append-only signed history ───────────────────────────────
create table if not exists agent_actions (
    id             bigserial primary key,
    agent_id       uuid not null references agent_identities(id) on delete cascade,
    type           text not null,
    payload        jsonb not null default '{}'::jsonb,
    source_skill   text,
    signature      text,
    signer_address text,
    created_at     timestamptz not null default now()
);

create index if not exists agent_actions_agent_time
    on agent_actions(agent_id, created_at desc);
create index if not exists agent_actions_type_time
    on agent_actions(type, created_at desc);

do $$ begin
    create trigger agent_identities_set_updated_at before update on agent_identities
        for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;

-- ── widgets — saved configurations of avatars rendered in a widget runtime ──
create table if not exists widgets (
    id              text primary key,                -- 'wdgt_' + 12 base64url chars
    user_id         uuid not null references users(id) on delete cascade,
    avatar_id       uuid references avatars(id) on delete set null,
    type            text not null check (type in ('turntable','animation-gallery','talking-agent','passport','hotspot-tour')),
    name            text not null,
    config          jsonb not null default '{}'::jsonb,
    is_public       boolean not null default true,
    view_count      bigint not null default 0,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    deleted_at      timestamptz
);

create index if not exists widgets_user_idx
    on widgets(user_id) where deleted_at is null;
create index if not exists widgets_type_idx
    on widgets(type) where deleted_at is null;

do $$ begin
    create trigger widgets_set_updated_at before update on widgets
        for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;

-- ── widget_views — anonymous load events for widget owner analytics ─────────
-- No IPs, no UAs, no cookies. country from x-vercel-ip-country edge header.
create table if not exists widget_views (
    id            bigserial primary key,
    widget_id     text not null references widgets(id) on delete cascade,
    country       text,
    referer_host  text,
    created_at    timestamptz not null default now()
);

create index if not exists widget_views_widget_time
    on widget_views(widget_id, created_at desc);

-- ── erc8004_agents_index — crawled directory of every on-chain agent ───────
-- Populated by api/cron/erc8004-crawl.js from Etherscan V2 getLogs across every
-- chain in REGISTRY_DEPLOYMENTS. Metadata fields are lazily filled from each
-- agent's agentURI JSON. `has_3d` = true when services[name=avatar] is set.
create table if not exists erc8004_agents_index (
    chain_id           integer     not null,
    agent_id           text        not null,                -- uint256 as decimal string
    owner              text        not null,                -- 0x-lowercase
    registry           text        not null,                -- 0x-lowercase contract addr
    agent_uri          text,
    name               text,
    description        text,
    image              text,                                -- 2D thumbnail URL
    glb_url            text,                                -- services[name=avatar] endpoint
    services           jsonb       not null default '[]'::jsonb,
    x402_support       boolean     not null default false,
    has_3d             boolean     not null default false,
    active             boolean     not null default true,
    registered_block   bigint,
    registered_tx      text,
    registered_at      timestamptz,
    last_metadata_at   timestamptz,
    metadata_error     text,
    last_seen_at       timestamptz not null default now(),
    primary key (chain_id, agent_id)
);

create index if not exists erc8004_agents_has3d_time
    on erc8004_agents_index(has_3d, registered_at desc) where active;
create index if not exists erc8004_agents_chain_time
    on erc8004_agents_index(chain_id, registered_at desc) where active;
create index if not exists erc8004_agents_owner
    on erc8004_agents_index(owner) where active;
create index if not exists erc8004_agents_metadata_stale
    on erc8004_agents_index(last_metadata_at nulls first);

create table if not exists erc8004_crawl_cursor (
    chain_id       integer primary key,
    last_block     bigint  not null default 0,
    updated_at     timestamptz not null default now()
);

-- Additive migrations for usage_events.
alter table usage_events add column if not exists agent_id uuid references agent_identities(id) on delete set null;
create index if not exists usage_events_agent_time on usage_events(agent_id, created_at desc) where agent_id is not null;

-- ── agent_registrations_pending — transient prep records for 2-step registration ─────
create table if not exists agent_registrations_pending (
	id              uuid primary key default gen_random_uuid(),
	user_id         uuid not null references users(id) on delete cascade,
	cid             text not null,                         -- IPFS CID
	metadata_uri    text not null,                         -- ipfs://CID
	payload         jsonb not null,                        -- registration JSON
	created_at      timestamptz not null default now(),
	expires_at      timestamptz not null
);

create index if not exists agent_registrations_pending_user_expiry
	on agent_registrations_pending(user_id, expires_at);

-- ── Additive: ensure partial unique index exists (required by ON CONFLICT in agents.js) ──
create unique index if not exists agent_identities_user_unique
    on agent_identities(user_id) where deleted_at is null;

-- ── agent_delegations — ERC-7710 signed delegation envelopes ────────────────
create table if not exists agent_delegations (
    id                  uuid primary key default gen_random_uuid(),
    agent_id            uuid not null references agent_identities(id) on delete cascade,
    chain_id            integer not null,
    delegator_address   text not null,
    delegate_address    text not null,
    delegation_hash     text not null unique,
    delegation_json     jsonb not null,
    scope               jsonb not null,
    status              text not null default 'active',
    expires_at          timestamptz not null,
    created_at          timestamptz not null default now(),
    revoked_at          timestamptz,
    tx_hash_revoke      text,
    last_redeemed_at    timestamptz,
    redemption_count    integer not null default 0,

    constraint agent_delegations_status_check
        check (status in ('active', 'revoked', 'expired')),
    constraint agent_delegations_chain_id_check
        check (chain_id > 0),
    constraint agent_delegations_delegator_address_check
        check (length(delegator_address) = 42 and delegator_address like '0x%'),
    constraint agent_delegations_delegate_address_check
        check (length(delegate_address) = 42 and delegate_address like '0x%')
);

create index if not exists idx_delegations_agent on agent_delegations(agent_id);
create index if not exists idx_delegations_status on agent_delegations(status) where status = 'active';
create index if not exists idx_delegations_delegator on agent_delegations(delegator_address);

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
