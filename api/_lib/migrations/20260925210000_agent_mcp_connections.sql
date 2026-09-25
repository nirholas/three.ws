-- External MCP servers connected to one agent.
--
-- An agent owner connects a server from the vetted catalog (data/mcp-catalog.json,
-- /integrations/mcp) or by URL. The server's tools are then mounted into that
-- agent's server-side tool loop under `ext_<name>_<tool>` names
-- (api/_lib/mcp-connections/runtime.js), each classified into the read, write or
-- financial tier. Only tools named in `enabled_tools` are ever offered to the
-- model: a new catalog connection starts with its read tools, a custom server
-- starts with none until the owner has reviewed the list.
--
-- credentials_enc holds one AES-256-GCM box (api/_lib/secret-box.js, the same
-- primitive as the custodial wallet keys) over a JSON document:
--   { "bearer": "...", "tokens": {...}, "client": {...}, "verifier": "...", "discovery": {...} }
-- so a database read alone never yields a usable token.
--
-- oauth_state_hash is the sha256 of the random `state` sent to the
-- authorization server; the callback finds the connection by it, and it is
-- cleared once used or after oauth_state_expires_at.

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

-- The tool loop reads one agent's active connections on every turn.
CREATE INDEX IF NOT EXISTS agent_mcp_connections_agent
	ON agent_mcp_connections (agent_id, status);

-- The OAuth callback resolves a connection by its pending state.
CREATE UNIQUE INDEX IF NOT EXISTS agent_mcp_connections_oauth_state
	ON agent_mcp_connections (oauth_state_hash) WHERE oauth_state_hash IS NOT NULL;
