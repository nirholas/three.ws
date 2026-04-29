-- Migration: global brand config for three.ws chat.
-- Apply: psql "$DATABASE_URL" -f api/_lib/migrations/2026-04-29-chat-brand-config.sql
-- Idempotent.

begin;

create table if not exists chat_brand_config (
    key          text primary key default 'global',
    name         text not null default 'three.ws chat',
    logo_url     text,
    accent_color text not null default '#6366f1',
    tagline      text not null default 'Chat with any AI model',
    updated_at   timestamptz not null default now()
);

-- Seed the single global row
insert into chat_brand_config (key) values ('global') on conflict do nothing;

commit;

-- v2: default model for built-in provider
ALTER TABLE chat_brand_config ADD COLUMN IF NOT EXISTS default_model TEXT NOT NULL DEFAULT 'google/gemini-2.0-flash-exp:free';
