-- Migration: free, anonymous install tokens for the keyless 3D Studio MCP servers.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261009120000_mcp_studio_installs.sql
-- Idempotent.
--
-- A cloud agent (Grok Bot, the xAI API, any hosted MCP client) reaches the free
-- studio from a shared egress pool, so a per-IP generation cap rations every user
-- of that pool as one caller. An install token gives each installation its own
-- identity without an account: POST /api/mcp-studio/install mints a random
-- token, the connector URL carries it as ?install=<token>, and the per-caller
-- caps key on it. Only the SHA-256 of the token is stored, so a database read
-- never yields a usable connector URL.

create table if not exists mcp_studio_installs (
	token_hash text        primary key,
	created_at timestamptz not null default now()
);

create index if not exists mcp_studio_installs_created_idx on mcp_studio_installs (created_at);
