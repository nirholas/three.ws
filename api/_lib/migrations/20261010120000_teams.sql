-- Migration: specialist trading teams and the shared findings board.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261010120000_teams.sql
-- Idempotent.
--
-- A team is a private squad of specialist agents owned by one account: a
-- Researcher that vets tokens, an Entry specialist that watches for setups, a
-- Trader that executes inside the spend rules, and a Launcher that prepares
-- launches for the owner to sign. Every member is an ordinary agent_identities
-- row (its own 3D body, custodial wallet and public page); these tables only
-- add the role, the permission set and the budget on top.
--
-- teams.policy_agent_id is the wallet policy reference: the Trader agent whose
-- meta.trade_limits and spend policy every team trade runs through. teams.policy
-- is the owner-facing snapshot of the caps the team was created with.
--
-- team_findings is the board the specialists share. A Trader must cite a live
-- (non-expired) research finding for the mint it trades, or run research itself
-- and write it back, so research is reused rather than redone. Every row the
-- runtime writes carries its evidence, the findings it cited and, for executed
-- trades, the custody event id that is its receipt.

create table if not exists teams (
	id               uuid        primary key default gen_random_uuid(),
	owner_user_id    uuid        not null references users(id) on delete cascade,
	name             text        not null check (length(name) between 1 and 60),
	description      text        check (description is null or length(description) <= 500),
	network          text        not null default 'mainnet' check (network in ('mainnet', 'devnet')),
	status           text        not null default 'provisioning'
	                 check (status in ('provisioning', 'active', 'paused', 'failed', 'archived')),
	-- The Trader agent whose wallet and spend policy govern team trades.
	policy_agent_id  uuid        references agent_identities(id) on delete set null,
	-- { per_trade_sol, daily_budget_sol, finding_ttl_seconds, allow_caution, entry }
	policy           jsonb       not null default '{}'::jsonb,
	is_public        boolean     not null default false,
	last_error       text,
	created_at       timestamptz not null default now(),
	updated_at       timestamptz not null default now(),
	archived_at      timestamptz
);
create index if not exists teams_owner_idx on teams (owner_user_id, created_at desc) where archived_at is null;

create table if not exists team_members (
	id               uuid        primary key default gen_random_uuid(),
	team_id          uuid        not null references teams(id) on delete cascade,
	agent_id         uuid        not null references agent_identities(id) on delete cascade,
	role             text        not null check (role in ('researcher', 'entry', 'trader', 'launcher', 'custom')),
	-- Granted permissions. The runtime intersects these with the role's ceiling
	-- on every action, so a row edited by hand can never widen a role.
	permissions      text[]      not null default '{}'::text[],
	-- Daily SOL budget in lamports. Only the Trader spends; null means no budget.
	budget_lamports  numeric(40, 0) check (budget_lamports is null or budget_lamports >= 0),
	status           text        not null default 'active' check (status in ('active', 'removed')),
	created_at       timestamptz not null default now()
);
create unique index if not exists team_members_agent_uniq on team_members (team_id, agent_id);
-- One active member per fixed role; custom members may repeat.
create unique index if not exists team_members_role_uniq
	on team_members (team_id, role) where role <> 'custom' and status = 'active';
create index if not exists team_members_agent_idx on team_members (agent_id);

create table if not exists team_findings (
	id               uuid        primary key default gen_random_uuid(),
	team_id          uuid        not null references teams(id) on delete cascade,
	member_id        uuid        references team_members(id) on delete set null,
	author_role      text        not null check (author_role in ('researcher', 'entry', 'trader', 'launcher', 'custom')),
	author_agent_id  uuid        references agent_identities(id) on delete set null,
	kind             text        not null check (kind in ('research', 'entry_signal', 'trade', 'launch_prep')),
	subject_kind     text        not null check (subject_kind in ('mint', 'topic')),
	subject          text        not null check (length(subject) between 1 and 120),
	verdict          text        not null check (length(verdict) between 1 and 24),
	score            int         check (score is null or score between 0 and 100),
	summary          text        not null check (length(summary) <= 600),
	evidence         jsonb       not null default '{}'::jsonb,
	-- Finding ids this row relied on (a trade cites the research it acted on).
	cites            uuid[]      not null default '{}'::uuid[],
	-- Custody event id for an executed trade; null for read-only findings.
	receipt_id       text,
	expires_at       timestamptz,
	created_at       timestamptz not null default now()
);
create index if not exists team_findings_team_idx on team_findings (team_id, created_at desc);
create index if not exists team_findings_subject_idx on team_findings (team_id, kind, subject, created_at desc);
