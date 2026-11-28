-- Migration: Basecamp Campfire chatbot connections.
-- Apply: npm run db:migrate
-- Idempotent.
--
-- One row per command URL a three.ws account created for a Basecamp chatbot.
-- Basecamp does not sign the POSTs it sends to a chatbot's command URL, so the
-- unguessable token in that URL is the only credential: only its SHA-256 is
-- stored, the URL is shown once at creation, and `token_hint` (the last four
-- characters) lets the owner tell two URLs apart in settings. A revoked row
-- stays for its history and answers every later command with a "revoked"
-- line instead of running anything. Generations a command starts are owned by
-- `user_id`, so they land in that account's forge history and count against
-- its limits. `last_basecamp_account` is the numeric account id from the last
-- callback URL, shown in settings so the owner can see which Basecamp is using
-- the URL.

begin;

create table if not exists basecamp_chatbots (
    id                      uuid        primary key default gen_random_uuid(),
    user_id                 uuid        not null references users(id) on delete cascade,
    label                   text        not null,
    token_hash              text        not null unique,
    token_hint              text        not null,
    command_count           integer     not null default 0,
    last_command_at         timestamptz,
    last_basecamp_account   text,
    created_at              timestamptz not null default now(),
    revoked_at              timestamptz
);

create index if not exists basecamp_chatbots_user on basecamp_chatbots (user_id, created_at desc);

commit;
