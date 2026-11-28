-- Migration: Linear workspaces that installed the three.ws agent.
-- Apply: npm run db:migrate
-- Idempotent.
--
-- One row per Linear workspace (organization) that added the three.ws app with
-- actor=app OAuth. People in that workspace mention @three.ws on an issue, or
-- delegate an issue to it, and the agent makes a 3D model and posts it back in
-- the issue's agent session (api/_lib/linear-agent.js).
--
-- Linear access tokens last 24 hours and refresh tokens 30 days, and every
-- refresh rotates both, so the pair is stored sealed with the secret box
-- (api/_lib/secret-box.js) and replaced on each refresh. `app_user_id` is the
-- app's user in that workspace (the `viewer` of its token), which Linear sends
-- as `appUserId` on every agent webhook. Generations are owned by
-- `installed_by`, the three.ws account that ran the install, so they land in
-- that account's forge history and count against its limits. A row revoked by
-- Linear (OAuthApp revoked webhook) or by its owner keeps its history.

begin;

create table if not exists linear_installs (
    organization_id     text        primary key,
    organization_name   text,
    organization_key    text,
    app_user_id         text        not null,
    access_token        text        not null,
    refresh_token       text,
    expires_at          timestamptz,
    scope               text,
    installed_by        uuid        not null references users(id) on delete cascade,
    session_count       integer     not null default 0,
    last_session_at     timestamptz,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),
    revoked_at          timestamptz
);

create index if not exists linear_installs_installed_by on linear_installs (installed_by, created_at desc);

commit;
