-- Migration: which AI clients use the hosted three.ws MCP servers.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261009172000_mcp_client_analytics.sql
-- Idempotent.
--
-- Every MCP `initialize` carries clientInfo.name and version. The servers record
-- it per session and count tool calls against that session, so the question
-- "how much of our traffic is Grok Bot versus Claude, ChatGPT or Cursor" has an
-- answer. No request body, argument, IP or token is ever stored, only a
-- normalized client name, its version, the auth kind and tool names.
--
--   mcp_client_sessions    raw rows, one per initialize. Expire after 30 days
--                          (api/cron/db-retention.js).
--   mcp_client_daily       durable aggregate per day, surface, client, version
--                          and auth kind: sessions opened and calls made.
--   mcp_client_tool_daily  durable aggregate of calls per tool for the same day,
--                          surface, client and auth kind.

create table if not exists mcp_client_sessions (
	session_id     text        primary key,
	surface        text        not null,
	client_name    text        not null,
	client_version text        not null default '',
	auth_kind      text        not null,
	calls          integer     not null default 0,
	created_at     timestamptz not null default now(),
	last_seen_at   timestamptz not null default now()
);

create index if not exists mcp_client_sessions_last_seen_idx on mcp_client_sessions (last_seen_at);

create table if not exists mcp_client_daily (
	day            date    not null,
	surface        text    not null,
	client_name    text    not null,
	client_version text    not null default '',
	auth_kind      text    not null,
	sessions       integer not null default 0,
	calls          integer not null default 0,
	primary key (day, surface, client_name, client_version, auth_kind)
);

create table if not exists mcp_client_tool_daily (
	day         date    not null,
	surface     text    not null,
	client_name text    not null,
	auth_kind   text    not null,
	tool        text    not null,
	calls       integer not null default 0,
	primary key (day, surface, client_name, auth_kind, tool)
);
