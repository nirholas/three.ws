-- OAuth 2.0 client credentials for the team SCIM endpoint (RFC 6749 4.4).
-- The Microsoft Entra app gallery only onboards provisioning apps that
-- authenticate this way; the long-lived team bearer (team_scim_tokens) stays
-- for non-gallery setups and for Microsoft's validation runs.
-- Data layer: api/_lib/team-enterprise.js. Token endpoint: api/scim/token.js
-- (POST /scim/oauth/token). Idempotent and additive.
--
--   team_scim_clients        client id (the row id) and the SHA-256 of its
--                            secret. Secrets expire one to three years after
--                            creation; up to five are active per team so a
--                            customer rotates without downtime.
--   team_scim_access_tokens  the short-lived bearers the token endpoint
--                            issues (one hour). Only hashes are stored.

create table if not exists team_scim_clients (
	id                 uuid        primary key default gen_random_uuid(),
	team_id            uuid        not null references teams(id) on delete cascade,
	secret_hash        text        not null unique,
	-- First characters of the secret, so the owner can tell secrets apart.
	secret_prefix      text        not null,
	created_by_user_id uuid        references users(id) on delete set null,
	created_at         timestamptz not null default now(),
	expires_at         timestamptz not null,
	last_used_at       timestamptz,
	revoked_at         timestamptz
);

create index if not exists team_scim_clients_team_idx on team_scim_clients (team_id) where revoked_at is null;

create table if not exists team_scim_access_tokens (
	token_hash         text        primary key,
	client_id          uuid        not null references team_scim_clients(id) on delete cascade,
	team_id            uuid        not null references teams(id) on delete cascade,
	created_at         timestamptz not null default now(),
	expires_at         timestamptz not null
);

create index if not exists team_scim_access_tokens_expiry_idx on team_scim_access_tokens (expires_at);
