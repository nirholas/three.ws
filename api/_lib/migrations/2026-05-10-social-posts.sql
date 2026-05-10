-- Migration: social_posts — scheduled and published social media posts.
-- Idempotent. updated_at is managed by application code.

create table if not exists social_posts (
    id               uuid primary key default gen_random_uuid(),
    platform         text not null
                         check (platform in ('x', 'farcaster', 'reddit')),
    content          text not null,
    media_urls       jsonb not null default '[]',
    reply_to         text,
    settings         jsonb not null default '{}',
    credentials_enc  text,
    schedule_at      timestamptz,
    status           text not null default 'pending'
                         check (status in ('pending', 'scheduled', 'published', 'failed', 'cancelled')),
    platform_post_id text,
    platform_url     text,
    platform_response jsonb,
    error_message    text,
    agent_id         text,
    requester_ip     text,
    created_at       timestamptz not null default now(),
    published_at     timestamptz,
    updated_at       timestamptz not null default now()
);

create index if not exists social_posts_status_schedule
    on social_posts (status, schedule_at)
    where status = 'scheduled';

create index if not exists social_posts_agent
    on social_posts (agent_id)
    where agent_id is not null;
