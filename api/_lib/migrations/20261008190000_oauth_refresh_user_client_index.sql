-- Migration: index refresh tokens by person and client.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261008190000_oauth_refresh_user_client_index.sql
-- Idempotent.
--
-- Every OAuth access token is now checked against its grant on each request,
-- so revoking an app in Connected apps ends it on the next call instead of
-- when its hour-long token expires (oauthGrantRevoked in api/_lib/auth.js).
-- That lookup filters on (user_id, client_id) across revoked rows too, which
-- the existing partial index on live rows cannot serve. The table gains a row
-- per refresh, so without this index the check grows into a scan on every
-- MCP call. The code is correct without it; this keeps it fast.

create index if not exists oauth_refresh_user_client on oauth_refresh_tokens (user_id, client_id);
