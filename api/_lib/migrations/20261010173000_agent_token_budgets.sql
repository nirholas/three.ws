-- Migration: per-agent token budgets. An owner can cap how many tokens an
-- agent's model calls may consume per hour, per day and per run, next to the
-- dollar budget that already lives on agent_identities.meta.inference_budget.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261010173000_agent_token_budgets.sql
-- Idempotent.
--
-- agent_token_usage
--   One row per (agent, window, window key). `window` is hour, day or run;
--   `window_key` is the UTC hour (YYYY-MM-DDTHH), the UTC day (YYYY-MM-DD) or
--   the run id. `tokens` is what settled calls consumed; `reserved` is what
--   admitted calls still hold while they are in flight. The gate admits a call
--   with a single conditional upsert (tokens + reserved + quantum <= ceiling),
--   so two calls racing for the last tokens of a window cannot both pass: the
--   row lock serializes them and the second finds the condition false.
--   The ceilings themselves stay on agent_identities.meta.token_budget so a
--   PATCH on the agent changes them without a schema round trip.

create table if not exists agent_token_usage (
	agent_id    uuid        not null references agent_identities(id) on delete cascade,
	"window"    text        not null check ("window" in ('hour', 'day', 'run')),
	window_key  text        not null,
	tokens      bigint      not null default 0 check (tokens >= 0),
	reserved    bigint      not null default 0 check (reserved >= 0),
	calls       integer     not null default 0,
	updated_at  timestamptz not null default now(),
	primary key (agent_id, "window", window_key)
);

create index if not exists agent_token_usage_updated_idx on agent_token_usage (updated_at);
