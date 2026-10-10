-- Migration: the team coordinator chat. One plain-language message becomes a run:
-- a frozen plan of role-tagged steps that the squad's specialists work through,
-- pausing on any step that signs, transfers, launches or exceeds a cap until the
-- owner approves it.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261010150000_team_chat.sql
-- Idempotent.
--
-- team_chat_runs
--   squad_id        the team (teams.id) or, for a solo squad, the agent
--                   (agent_identities.id) the owner is talking to. squad_kind says
--                   which. A uuid with no foreign key, so this table stands
--                   on its own whether or not the team runtime is installed.
--   policy_agent_id the agent whose wallet and spend policy every trade runs
--                   through (the team's Trader, or the solo agent).
--   mode            paper simulates every trade against live quotes and never
--                   signs; live signs from the policy agent's custodial wallet.
--   plan            the plan exactly as the owner saw it. Frozen before any token
--                   metadata is fetched, so untrusted coin text can never add a
--                   step or change an amount or recipient.
--   lock_until      a short lease so two requests (the approve call and a resumed
--                   stream) never advance the same run at once.
--
-- team_chat_steps
--   One row per plan step. status walks queued -> running -> done | failed |
--   skipped, or queued -> needs_approval -> executing -> done | failed, or ends in
--   denied / expired. approval holds the exact action, its payload hash and the
--   confirmation table the owner was shown. approval_request_id links the row
--   in the approval inbox when that inbox is installed, so a decision from push,
--   Telegram or /approvals resumes the same run.
--
-- team_chat_events
--   The append-only stream the chat renders: run, memory, plan, step status,
--   evidence, approval and summary events. Persisted so a reload, a second tab or
--   a decision taken elsewhere replays the same story.

create table if not exists team_chat_runs (
	id               uuid        primary key default gen_random_uuid(),
	user_id          uuid        not null references users(id) on delete cascade,
	squad_id         uuid        not null,
	squad_kind       text        not null check (squad_kind in ('team', 'agent')),
	policy_agent_id  uuid        references agent_identities(id) on delete set null,
	utterance        text        not null check (length(utterance) between 1 and 2000),
	mode             text        not null default 'paper' check (mode in ('paper', 'live')),
	network          text        not null default 'mainnet' check (network in ('mainnet', 'devnet')),
	planner          text,
	plan             jsonb       not null default '{}'::jsonb,
	status           text        not null default 'planning'
		check (status in ('planning', 'running', 'awaiting_approval', 'done', 'failed', 'cancelled')),
	summary          jsonb,
	lock_until       timestamptz,
	created_at       timestamptz not null default now(),
	updated_at       timestamptz not null default now()
);
create index if not exists team_chat_runs_squad_idx on team_chat_runs (user_id, squad_id, created_at desc);
create index if not exists team_chat_runs_open_idx on team_chat_runs (user_id, status) where status in ('running', 'awaiting_approval');

create table if not exists team_chat_steps (
	id                   uuid        primary key default gen_random_uuid(),
	run_id               uuid        not null references team_chat_runs(id) on delete cascade,
	idx                  int         not null check (idx between 0 and 31),
	step_key             text        not null check (length(step_key) between 1 and 16),
	role                 text        not null check (role in ('coordinator', 'researcher', 'entry', 'trader', 'launcher')),
	kind                 text        not null,
	title                text        not null check (length(title) between 1 and 200),
	params               jsonb       not null default '{}'::jsonb,
	depends_on           text[]      not null default '{}'::text[],
	agent_id             uuid        references agent_identities(id) on delete set null,
	status               text        not null default 'queued'
		check (status in ('queued', 'running', 'needs_approval', 'executing', 'done', 'failed', 'skipped', 'denied', 'expired')),
	evidence             jsonb       not null default '{}'::jsonb,
	result               jsonb,
	approval             jsonb,
	approval_request_id  uuid,
	error                text,
	started_at           timestamptz,
	finished_at          timestamptz,
	updated_at           timestamptz not null default now()
);
create unique index if not exists team_chat_steps_run_idx on team_chat_steps (run_id, idx);
create index if not exists team_chat_steps_approval_idx on team_chat_steps (approval_request_id) where approval_request_id is not null;

create table if not exists team_chat_events (
	id          bigserial   primary key,
	run_id      uuid        not null references team_chat_runs(id) on delete cascade,
	step_id     uuid,
	kind        text        not null,
	payload     jsonb       not null default '{}'::jsonb,
	created_at  timestamptz not null default now()
);
create index if not exists team_chat_events_run_idx on team_chat_events (run_id, id);
