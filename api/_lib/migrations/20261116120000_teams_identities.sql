-- Migration: Microsoft Teams identity mapping for activity feed notifications.
-- Apply: npm run db:migrate
-- Idempotent.
--
-- One row per Teams person (tenant id + Entra object id) the three.ws bot has
-- seen, captured from installationUpdate and message activities after the Bot
-- Framework token is verified. `installed` is the install state Graph's
-- sendActivityNotification requires. `user_id` stays null until that person
-- links their Teams account to a three.ws account with a one-time code, and is
-- cleared again on uninstall, so nothing is ever sent to a person who removed
-- the app. The last_error_* columns record a permanent Graph failure once (for
-- example admin consent missing) so settings can say why nothing arrives.

begin;

create table if not exists teams_identities (
    tenant_id       text        not null,
    aad_object_id   text        not null,
    user_id         uuid        references users(id) on delete cascade,
    installed       boolean     not null default true,
    linked_at       timestamptz,
    last_sent_at    timestamptz,
    last_error_code text,
    last_error_at   timestamptz,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    primary key (tenant_id, aad_object_id)
);

create index if not exists teams_identities_user on teams_identities (user_id) where user_id is not null;

commit;
