-- Two migrations created agent_mcp_connections with different column sets, both
-- with CREATE TABLE IF NOT EXISTS, so whichever ran first won and the other was
-- a silent no-op:
--   20260925150000 (url, credentials, auth_state, custom_url, tools_fetched_at)
--   20260925210000 (server_url, credentials_enc, oauth_state_expires_at,
--                   oauth_return_to, acknowledged_tools, tools_refreshed_at)
-- The code in api/_lib/mcp-connections reads the second shape. This migration
-- converges a database that ended up with the first shape. It only rebuilds the
-- table when it is empty, so no connection is ever discarded; a populated table
-- with the wrong shape fails loudly instead.

DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_schema = current_schema()
		  AND table_name = 'agent_mcp_connections'
		  AND column_name = 'credentials'
	) AND NOT EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_schema = current_schema()
		  AND table_name = 'agent_mcp_connections'
		  AND column_name = 'credentials_enc'
	) THEN
		IF EXISTS (SELECT 1 FROM agent_mcp_connections) THEN
			RAISE EXCEPTION 'agent_mcp_connections has the legacy column set and holds rows; convert them by hand before this migration can reshape the table';
		END IF;
		DROP TABLE agent_mcp_connections;
	END IF;
END $$;

CREATE TABLE IF NOT EXISTS agent_mcp_connections (
	id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	agent_id               uuid NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
	user_id                uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	name                   text NOT NULL CHECK (name ~ '^[a-z0-9][a-z0-9_]{0,23}$'),
	catalog_id             text,
	server_url             text NOT NULL,
	label                  text NOT NULL,
	transport              text NOT NULL DEFAULT 'streamable-http' CHECK (transport IN ('streamable-http', 'sse')),
	auth_type              text NOT NULL CHECK (auth_type IN ('oauth', 'bearer', 'none')),
	status                 text NOT NULL DEFAULT 'pending_auth'
	                       CHECK (status IN ('pending_auth', 'pending_review', 'active', 'needs_auth', 'error', 'disabled')),
	credentials_enc        text,
	oauth_state_hash       text,
	oauth_state_expires_at timestamptz,
	oauth_return_to        text,
	tools                  jsonb NOT NULL DEFAULT '[]'::jsonb,
	tools_refreshed_at     timestamptz,
	server_info            jsonb,
	enabled_tools          text[] NOT NULL DEFAULT '{}',
	tier_overrides         jsonb NOT NULL DEFAULT '{}'::jsonb,
	acknowledged_tools     text[] NOT NULL DEFAULT '{}',
	reviewed_at            timestamptz,
	last_error             text,
	last_used_at           timestamptz,
	token_expires_at       timestamptz,
	created_at             timestamptz NOT NULL DEFAULT now(),
	updated_at             timestamptz NOT NULL DEFAULT now(),
	UNIQUE (agent_id, name),
	CHECK (catalog_id IS NOT NULL OR server_url IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS agent_mcp_connections_agent
	ON agent_mcp_connections (agent_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS agent_mcp_connections_oauth_state
	ON agent_mcp_connections (oauth_state_hash) WHERE oauth_state_hash IS NOT NULL;
