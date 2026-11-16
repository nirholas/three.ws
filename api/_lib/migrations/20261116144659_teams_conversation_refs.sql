-- Migration: Microsoft Teams 1:1 conversation references, for approval cards.
-- Apply: npm run db:migrate
-- Idempotent.
--
-- One row per Teams person (tenant id + Entra object id) who has the three.ws
-- app in a personal (1:1) chat with the bot. It holds the conversation
-- reference the Bot Connector needs to post a card there proactively: the
-- serviceUrl of that person's region, the 1:1 conversation id, the bot's own
-- id, and the person's Teams MRI (29:...), which Universal Actions cards name
-- in refresh.userIds so the card refreshes to the request's current state.
--
-- Captured by api/_lib/teams-approvals.js from installationUpdate,
-- conversationUpdate and message activities, only after the Bot Framework
-- token on the activity is verified. Uninstalling deletes the row, so nothing
-- is ever sent to a person who removed the app.
--
-- The row does not store a three.ws account. The owner is resolved at send
-- time from the Microsoft identity linked to the account (user_identities,
-- provider 'microsoft', subject '<tid>:<oid>'), so unlinking Microsoft in
-- settings stops delivery at once without touching this table.

begin;

create table if not exists teams_conversation_refs (
    tenant_id        text        not null check (tenant_id ~ '^[0-9a-f-]{36}$'),
    aad_object_id    text        not null check (aad_object_id ~ '^[0-9a-f-]{36}$'),
    teams_user_id    text        not null,
    user_name        text,
    service_url      text        not null check (service_url ~ '^https://'),
    conversation_id  text        not null,
    bot_id           text        not null,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    primary key (tenant_id, aad_object_id)
);

-- The owner's switch for the Teams approval channel (the Microsoft Teams panel
-- on /approvals). No row means on: installing the app in a 1:1 chat is already
-- the opt-in, the same way pairing a Telegram chat is.
create table if not exists teams_approval_prefs (
    user_id     uuid        primary key references users(id) on delete cascade,
    enabled     boolean     not null default true,
    updated_at  timestamptz not null default now()
);

commit;
