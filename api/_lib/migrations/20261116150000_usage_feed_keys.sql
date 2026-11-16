-- Migration: usage feed keys for the OData usage feed (Power BI and Excel).
-- Apply: npm run db:migrate
-- Idempotent.
--
-- A usage feed key is a read-only credential for /api/odata/v1/, sent as the
-- password of HTTP Basic auth so Power BI Service can refresh a dataset on a
-- schedule without a gateway. It authenticates nothing else: it is not an
-- api_keys row, so a key pasted into a shared report cannot reach any other
-- three.ws route.
--
-- A key reads either its creator's own usage (team_id null) or the usage of a
-- team the creator owns (team_id set). The team binding is re-checked on every
-- request against teams.owner_user_id, so a key stops working the moment its
-- creator no longer owns the team or the team is archived.
--
-- Also adds the indexes the feed's per-user scans need on forge_creations
-- (the existing user index is partial on finished, stored models only) and
-- the Microsoft Marketplace metering rows (read per subscription by time).

begin;

create table if not exists usage_feed_keys (
    id            uuid        primary key default gen_random_uuid(),
    user_id       uuid        not null references users(id) on delete cascade,
    team_id       uuid        references teams(id) on delete cascade,
    name          text        not null check (length(name) between 1 and 80),
    prefix        text        not null,
    token_hash    text        not null unique,
    created_at    timestamptz not null default now(),
    last_used_at  timestamptz,
    revoked_at    timestamptz
);

create index if not exists usage_feed_keys_user on usage_feed_keys (user_id, created_at desc) where revoked_at is null;

create index if not exists forge_creations_user_time
    on forge_creations (user_id, created_at desc)
    where user_id is not null;

create index if not exists microsoft_saas_usage_events_subscription_time
    on microsoft_saas_usage_events (subscription_id, effective_start_time desc);

commit;
