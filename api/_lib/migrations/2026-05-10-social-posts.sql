-- Migration: social_posts — scheduled and published social media posts.
-- Apply: psql "$DATABASE_URL" -f api/_lib/migrations/2026-05-10-social-posts.sql
-- Idempotent.

begin;

create table if not exists social_posts (
    id              uuid primary key default gen_random_uuid(),
    platform        text not null
                        check (platform in ('x', 'farcaster', 'reddit')),
    content         text not null,
    media_urls      jsonb not null default '[]',
    reply_to        text,
    settings        jsonb not null default '{}',
    -- AES-256-GCM encrypted credential blob (iv.tag.ciphertext hex)
    credentials_enc text,
    -- scheduling
    schedule_at     timestamptz,
    status          text not null default 'pending'
                        check (status in ('pending', 'scheduled', 'published', 'failed', 'cancelled')),
    -- result
    platform_post_id text,
    platform_url     text,
    platform_response jsonb,
    error_message    text,
    -- attribution
    agent_id        text,
    requester_ip    text,
    -- timestamps
    created_at      timestamptz not null default now(),
    published_at    timestamptz,
    updated_at      timestamptz not null default now()
);

create index if not exists social_posts_status_schedule
    on social_posts (status, schedule_at)
    where status = 'scheduled';

create index if not exists social_posts_agent
    on social_posts (agent_id)
    where agent_id is not null;

-- Auto-update updated_at
create or replace function update_social_posts_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists social_posts_updated_at on social_posts;
create trigger social_posts_updated_at
    before update on social_posts
    for each row execute function update_social_posts_updated_at();

commit;
