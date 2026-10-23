-- Migration: stop mcp_client_sessions/mcp_client_daily writes crashing on the
-- `client` column neither surviving implementation populates.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261015010000_mcp_client_sessions_client_nullable.sql
-- Idempotent.
--
-- Two independent branches both built MCP client analytics and both migrated
-- the same table names. 20261008200000_mcp_client_analytics.sql ran first and
-- created mcp_client_sessions/mcp_client_daily with a `client not null` family
-- column (api/_lib/mcp-client-analytics.js). 20261009172000_mcp_client_analytics.sql
-- ran second against the same table names, so its `create table if not exists`
-- was a no-op for those two tables; only its new mcp_client_tool_daily table
-- actually landed. api/_lib/mcp-clients.js is the implementation that won the
-- merge (the ops read endpoint and the retention cron already depend on it),
-- and its inserts never set `client`, so every session/day row it writes
-- violates the not-null constraint the first migration left behind.
--
-- The column becomes nullable rather than dropped: api/_lib/mcp-client-analytics.js
-- and its migration stay in git history, and a null `client` simply reads as
-- "not classified by the winning implementation" rather than losing the column
-- outright.

-- Databases where the second migration created the tables first never had a
-- `client` column (they carry client_name/client_version instead), so each
-- statement only runs when the legacy column exists.
do $$
begin
	if exists (select 1 from information_schema.columns
		where table_schema = current_schema() and table_name = 'mcp_client_sessions' and column_name = 'client') then
		alter table mcp_client_sessions alter column client drop not null;
	end if;
	if exists (select 1 from information_schema.columns
		where table_schema = current_schema() and table_name = 'mcp_client_daily' and column_name = 'client') then
		alter table mcp_client_daily alter column client drop not null;
	end if;
end $$;
