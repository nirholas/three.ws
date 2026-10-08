-- Migration: know which AI clients use the hosted MCP servers.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261008200000_mcp_client_analytics.sql
-- Idempotent.
--
-- Every MCP `initialize` carries clientInfo { name, version }. The servers issue
-- an Mcp-Session-Id on initialize and record one row per session here, so a
-- later tools/call that echoes the id can be attributed to the client that
-- opened it. Nothing here stores a request body or a tool argument: only the
-- normalized client name and version, the surface, how the caller
-- authenticated, and per-tool call counts.
--
-- mcp_client_sessions is the raw, short-lived join table. db-retention deletes
-- rows idle for 30 days (api/cron/db-retention.js, windowKind `mcpSessions`).
-- mcp_client_daily is the aggregate the ops board reads, kept indefinitely: one
-- row per day, surface, client name, version and auth kind.
--
-- client is the family a name belongs to (claude, chatgpt, cursor, grok,
-- probe, ...), derived in api/_lib/mcp-client-analytics.js; client_name is the
-- name the client actually sent, trimmed, lowercased and capped at 64 chars.

create table if not exists mcp_client_sessions (
	session_id     text        primary key,
	surface        text        not null,
	client         text        not null,
	client_name    text        not null,
	client_version text        not null default '',
	auth_kind      text        not null check (auth_kind in ('anonymous', 'install', 'key', 'oauth', 'x402')),
	calls          integer     not null default 0,
	tool_calls     jsonb       not null default '{}'::jsonb,
	created_at     timestamptz not null default now(),
	last_seen_at   timestamptz not null default now()
);

create index if not exists mcp_client_sessions_last_seen_idx on mcp_client_sessions (last_seen_at);

create table if not exists mcp_client_daily (
	day            date        not null,
	surface        text        not null,
	client         text        not null,
	client_name    text        not null,
	client_version text        not null default '',
	auth_kind      text        not null check (auth_kind in ('anonymous', 'install', 'key', 'oauth', 'x402')),
	sessions       integer     not null default 0,
	calls          integer     not null default 0,
	tools          jsonb       not null default '{}'::jsonb,
	updated_at     timestamptz not null default now(),
	primary key (day, surface, client_name, client_version, auth_kind)
);

create index if not exists mcp_client_daily_day_idx on mcp_client_daily (day);

-- Add n to one tool's count in a { tool: count } object. A tool name comes from
-- the caller, so a client inventing names cannot grow the object without bound:
-- past 200 distinct keys every new name folds into "(other)".
create or replace function mcp_tool_count_add(counts jsonb, tool text, n integer)
returns jsonb
language sql
immutable
as $$
	select counts || jsonb_build_object(k, coalesce((counts ->> k)::integer, 0) + n)
	from (
		select case
			when counts ? tool or (select count(*) from jsonb_object_keys(counts)) < 200 then tool
			else '(other)'
		end as k
	) pick
$$;
