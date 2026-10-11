-- Migration: the approval inbox. Every gated agent action that needs the owner's
-- explicit yes becomes one row here, and an approval executes exactly the action
-- that was shown, once.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261010120000_approval_requests.sql
-- Idempotent.
--
-- approval_requests
--   payload        the exact action the executor will run, canonical JSON.
--   payload_hash   sha256 of the canonical payload. The approve call must echo
--                  the hash the owner was shown, and the executor recomputes it
--                  from `payload` before running, so neither a stale screen nor
--                  an edited row can execute something different.
--   idempotency_key  one request per gated event (an intent firing on one
--                  schedule bucket asks once, not once per sweep).
--   status         pending, then exactly one of: denied, expired, or approved,
--                  executing, executed | failed. The pending -> approved step is
--                  a single conditional UPDATE, so two taps on "Approve" (push
--                  plus web, or a double click) run the action once.
--   decided_via    which surface the decision came from: web, push, telegram,
--                  mobile, email, or auto_policy.
--   team_id        the specialist team the requester belongs to, when the
--                  request came from a team member (team runtime). Text, not a
--                  foreign key, so this table stands on its own.
--
-- approval_auto_policies
--   The owner's explicit "don't ask me for this" rules. Default is no row, which
--   means ask every time. Each policy is capped by size (max_usd per action) and
--   venue, scoped to all agents, one agent, or one team, and revocable at any
--   time; a revoked policy keeps its row so the audit trail stays readable.

create table if not exists approval_requests (
	id               uuid        primary key default gen_random_uuid(),
	user_id          uuid        not null references users(id) on delete cascade,
	agent_id         uuid        references agent_identities(id) on delete cascade,
	team_id          text,
	requester_role   text        not null default 'agent',
	source           text        not null,
	source_ref       text,
	action_type      text        not null,
	venue            text        not null,
	payload          jsonb       not null,
	payload_hash     text        not null check (payload_hash ~ '^[0-9a-f]{64}$'),
	summary          text        not null,
	amount           numeric,
	amount_usd       numeric,
	asset            text,
	chain            text        not null default 'solana',
	network          text        not null default 'mainnet',
	recipient        text,
	recipient_label  text,
	risk_notes       jsonb       not null default '[]'::jsonb,
	gate_reason      text,
	idempotency_key  text        not null,
	status           text        not null default 'pending'
		check (status in ('pending', 'approved', 'executing', 'executed', 'failed', 'denied', 'expired')),
	expires_at       timestamptz not null,
	decided_by       uuid        references users(id) on delete set null,
	decided_at       timestamptz,
	decided_via      text,
	auto_policy_id   uuid,
	executed_at      timestamptz,
	signature        text,
	result           jsonb,
	created_at       timestamptz not null default now(),
	updated_at       timestamptz not null default now()
);

create unique index if not exists approval_requests_idem_idx on approval_requests (idempotency_key);
create index if not exists approval_requests_user_created_idx on approval_requests (user_id, created_at desc, id desc);
create index if not exists approval_requests_pending_idx on approval_requests (user_id, expires_at) where status = 'pending';
create index if not exists approval_requests_source_idx on approval_requests (source, source_ref) where status = 'pending';

create table if not exists approval_auto_policies (
	id          uuid        primary key default gen_random_uuid(),
	user_id     uuid        not null references users(id) on delete cascade,
	agent_id    uuid        references agent_identities(id) on delete cascade,
	team_id     text,
	label       text        not null,
	venues      text[]      not null check (cardinality(venues) > 0),
	max_usd     numeric     not null check (max_usd > 0),
	expires_at  timestamptz,
	revoked_at  timestamptz,
	created_at  timestamptz not null default now()
);

create index if not exists approval_auto_policies_user_idx on approval_auto_policies (user_id) where revoked_at is null;
