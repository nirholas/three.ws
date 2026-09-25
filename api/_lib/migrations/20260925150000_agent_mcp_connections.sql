-- External MCP servers connected to one agent.
--
-- An agent owner connects a server from the vetted catalog (data/mcp-catalog.json,
-- `catalog_id`) or any public https URL (`custom_url`). The agent's server loop
-- (api/_lib/agents-v1/runs.js) and the local runtime (packages/agent-cli) then
-- mount the connection's enabled tools as `ext_<name>_<tool>`.
--
-- Credentials (a pasted bearer token, or the OAuth client registration, PKCE
-- verifier and tokens) are one JSON document encrypted with the same secret box
-- as custodial wallet keys (api/_lib/secret-box.js). They are never returned by
-- any route.
--
-- Tool enablement follows the platform tool tiers (packages/mcp-policy):
--   read       on for a new catalog connection
--   write      off until the owner enables the tool
--   financial  off until the owner enables it and acknowledges what it does
-- A custom server starts with nothing enabled and `status = 'pending_review'`
-- until the owner has read its tool list and approved it.

CREATE TABLE IF NOT EXISTS agent_mcp_connections (
	id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	agent_id         uuid NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
	user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	-- Tool prefix slug: tools mount as ext_<name>_<tool>. Unique per agent.
	name             text NOT NULL CHECK (name ~ '^[a-z0-9][a-z0-9_]{0,22}[a-z0-9]$'),
	label            text NOT NULL,
	catalog_id       text,
	custom_url       text,
	url              text NOT NULL,
	transport        text NOT NULL CHECK (transport IN ('streamable-http', 'sse')),
	auth_type        text NOT NULL CHECK (auth_type IN ('none', 'bearer', 'oauth')),
	-- ready: credentials work (or none are needed). needs_auth: sign in or paste
	-- a token. authorizing: an OAuth redirect is in flight.
	auth_state       text NOT NULL DEFAULT 'needs_auth' CHECK (auth_state IN ('ready', 'needs_auth', 'authorizing')),
	status           text NOT NULL DEFAULT 'active' CHECK (status IN ('pending_review', 'active', 'disabled', 'error')),
	credentials      text,
	-- sha256 of the OAuth `state` sent to the authorization server; the callback
	-- finds the connection by it. Cleared once the code is exchanged.
	oauth_state_hash text,
	oauth_started_at timestamptz,
	token_expires_at timestamptz,
	-- Classified snapshot of the server's tools/list:
	-- [{ name, title, description, inputSchema, annotations, tier, tierSource, flags }]
	tools            jsonb NOT NULL DEFAULT '[]'::jsonb,
	tools_fetched_at timestamptz,
	server_info      jsonb,
	enabled_tools    text[] NOT NULL DEFAULT '{}',
	-- { "<tool name>": "read" | "write" | "financial" } set by the owner.
	tier_overrides   jsonb NOT NULL DEFAULT '{}'::jsonb,
	reviewed_at      timestamptz,
	last_error       text,
	last_used_at     timestamptz,
	created_at       timestamptz NOT NULL DEFAULT now(),
	updated_at       timestamptz NOT NULL DEFAULT now(),
	CHECK ((catalog_id IS NULL) <> (custom_url IS NULL)),
	UNIQUE (agent_id, name)
);

-- The run loop reads one agent's active connections on every step.
CREATE INDEX IF NOT EXISTS agent_mcp_connections_agent
	ON agent_mcp_connections (agent_id, created_at, id);

-- The OAuth callback resolves a connection by the hash of its state.
CREATE UNIQUE INDEX IF NOT EXISTS agent_mcp_connections_oauth_state
	ON agent_mcp_connections (oauth_state_hash) WHERE oauth_state_hash IS NOT NULL;
