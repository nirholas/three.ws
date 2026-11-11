-- Migration: enterprise access for teams. Microsoft Entra tenant claims,
-- people (human team members), SCIM 2.0 provisioning and its audit trail.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261111160232_enterprise_sso_scim.sql
-- Idempotent and additive: no existing column or row changes meaning.
--
-- A team (20261010120000_teams.sql) was one owner plus a squad of agents. This
-- adds the people an organisation brings with it:
--
--   team_people             a human with access to a team. Joined by signing in
--                           with Microsoft from the team's claimed tenant, or
--                           provisioned by the tenant's SCIM client (Entra ID).
--                           A SCIM-provisioned person may exist before their
--                           three.ws account does (user_id null); their first
--                           Microsoft sign-in from the claimed tenant binds it.
--   team_tenant_claims      one Entra tenant belongs to at most one team. The
--                           claim is proven by a fresh sign-in of a directory
--                           admin of that tenant (api/auth/microsoft).
--   team_scim_tokens        the per-team bearer the team's SCIM client sends.
--                           Only a SHA-256 hash is stored; rotation replaces it.
--   team_scim_groups        SCIM Groups and their members (people of the team).
--   team_enterprise_events  every claim, join, provisioning call and token
--                           change, for the settings feed and audits.
--
-- sessions.entra_tenant_id records the tenant of the Microsoft identity a
-- session was signed in with, so deprovisioning a person from a team revokes
-- exactly the sessions that came through that team's tenant.

create table if not exists team_tenant_claims (
	team_id            uuid        primary key references teams(id) on delete cascade,
	tenant_id          text        not null unique check (tenant_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	tenant_name        text        check (tenant_name is null or length(tenant_name) <= 200),
	-- offer: a member signing in from the tenant is asked to join.
	-- auto:  they are added on sign-in.
	join_mode          text        not null default 'offer' check (join_mode in ('offer', 'auto')),
	claimed_by_user_id uuid        references users(id) on delete set null,
	-- Display only: who proved admin rights in the tenant, and with which role.
	verified_by        text        check (verified_by is null or length(verified_by) <= 320),
	verified_role      text        check (verified_role is null or length(verified_role) <= 80),
	claimed_at         timestamptz not null default now(),
	updated_at         timestamptz not null default now()
);

create table if not exists team_people (
	id                 uuid        primary key default gen_random_uuid(),
	team_id            uuid        not null references teams(id) on delete cascade,
	user_id            uuid        references users(id) on delete cascade,
	role               text        not null default 'member' check (role in ('member')),
	status             text        not null default 'active' check (status in ('active', 'deactivated', 'declined')),
	source             text        not null check (source in ('tenant_join', 'scim')),
	entra_tenant_id    text,
	-- SCIM attributes (RFC 7643 core User). user_name is the provisioning key.
	user_name          text        check (user_name is null or length(user_name) between 1 and 320),
	external_id        text        check (external_id is null or length(external_id) <= 320),
	display_name       text        check (display_name is null or length(display_name) <= 200),
	given_name         text        check (given_name is null or length(given_name) <= 120),
	family_name        text        check (family_name is null or length(family_name) <= 120),
	email              text        check (email is null or length(email) <= 320),
	created_at         timestamptz not null default now(),
	updated_at         timestamptz not null default now(),
	deactivated_at     timestamptz,
	-- SCIM DELETE: the person is deactivated and hidden from SCIM reads (the
	-- client expects a 404 afterwards) but the row stays, so an auto-join tenant
	-- cannot silently re-admit someone the directory removed. A later SCIM
	-- create with the same userName revives it.
	scim_deleted_at    timestamptz,
	last_provisioned_at timestamptz
);
create unique index if not exists team_people_user_uniq on team_people (team_id, user_id) where user_id is not null;
create unique index if not exists team_people_user_name_uniq on team_people (team_id, lower(user_name)) where user_name is not null;
create index if not exists team_people_user_idx on team_people (user_id) where user_id is not null;
create index if not exists team_people_team_idx on team_people (team_id, created_at);

create table if not exists team_scim_tokens (
	team_id            uuid        primary key references teams(id) on delete cascade,
	token_hash         text        not null unique,
	-- First characters of the plaintext, so the owner can tell tokens apart.
	token_prefix       text        not null,
	created_by_user_id uuid        references users(id) on delete set null,
	created_at         timestamptz not null default now(),
	rotated_at         timestamptz,
	last_used_at       timestamptz
);

create table if not exists team_scim_groups (
	id                 uuid        primary key default gen_random_uuid(),
	team_id            uuid        not null references teams(id) on delete cascade,
	display_name       text        not null check (length(display_name) between 1 and 256),
	external_id        text        check (external_id is null or length(external_id) <= 320),
	created_at         timestamptz not null default now(),
	updated_at         timestamptz not null default now()
);
create unique index if not exists team_scim_groups_name_uniq on team_scim_groups (team_id, lower(display_name));

create table if not exists team_scim_group_members (
	group_id           uuid        not null references team_scim_groups(id) on delete cascade,
	person_id          uuid        not null references team_people(id) on delete cascade,
	added_at           timestamptz not null default now(),
	primary key (group_id, person_id)
);
create index if not exists team_scim_group_members_person_idx on team_scim_group_members (person_id);

create table if not exists team_enterprise_events (
	id                 bigserial   primary key,
	team_id            uuid        not null references teams(id) on delete cascade,
	actor              text        not null check (actor in ('owner', 'scim', 'member', 'system')),
	actor_user_id      uuid        references users(id) on delete set null,
	action             text        not null check (length(action) between 1 and 60),
	person_id          uuid,
	detail             jsonb       not null default '{}'::jsonb,
	created_at         timestamptz not null default now()
);
create index if not exists team_enterprise_events_team_idx on team_enterprise_events (team_id, created_at desc);

alter table sessions add column if not exists entra_tenant_id text;
create index if not exists sessions_user_tenant_idx on sessions (user_id, entra_tenant_id) where entra_tenant_id is not null and revoked_at is null;
