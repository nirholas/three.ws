-- MCP tool policy settings: which tool groups a person has turned on.
--
-- Every three.ws MCP tool belongs to a group and a tier (packages/mcp-policy).
-- Read and write tiers are on by default and the financial tier is off; this
-- table records where a person has moved away from that default, once for the
-- whole account (api_key_id IS NULL) and optionally per API key, whose row only
-- needs the groups it overrides. The /settings/mcp-tools page writes it through
-- /api/mcp-tools and every hosted MCP server reads it on tools/list and
-- tools/call (api/_mcp/policy.js).
--
-- settings shape: { "groups": { "<group id>": true|false },
--                   "tools":  { "<tool name>": true|false } }

CREATE TABLE IF NOT EXISTS mcp_tool_settings (
	id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	api_key_id  uuid REFERENCES api_keys(id) ON DELETE CASCADE,
	settings    jsonb NOT NULL DEFAULT '{}'::jsonb,
	updated_at  timestamptz NOT NULL DEFAULT now()
);

-- One account row and at most one row per key.
CREATE UNIQUE INDEX IF NOT EXISTS mcp_tool_settings_account
	ON mcp_tool_settings (user_id) WHERE api_key_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS mcp_tool_settings_key
	ON mcp_tool_settings (api_key_id) WHERE api_key_id IS NOT NULL;
