-- MCP resource subscriptions (resources/subscribe on the hosted MCP servers).
--
-- A client subscribes to a three:// resource URI over POST; the notification
-- (notifications/resources/updated) is delivered later on the same client's
-- GET event stream, which may land on a different Cloud Run instance. The
-- subscription therefore lives here rather than in process memory.
--
-- subscriber_key identifies the client: its Mcp-Session-Id when it sends one,
-- otherwise the authenticated principal (user + API key or OAuth client), so a
-- POST and the GET stream from the same client resolve to the same key.
--
-- fingerprint is the last state the client was told about. The stream re-derives
-- it on each poll and emits an update only when it changes.

CREATE TABLE IF NOT EXISTS mcp_resource_subscriptions (
	id             bigserial PRIMARY KEY,
	server         text NOT NULL,                 -- 'mcp' | 'mcp-agent' | 'mcp-3d' | 'mcp-bazaar'
	subscriber_key text NOT NULL,
	user_id        uuid REFERENCES users(id) ON DELETE CASCADE,
	uri            text NOT NULL,
	fingerprint    text,
	created_at     timestamptz NOT NULL DEFAULT now(),
	checked_at     timestamptz,
	notified_at    timestamptz,
	UNIQUE (server, subscriber_key, uri)
);

CREATE INDEX IF NOT EXISTS mcp_resource_subscriptions_subscriber
	ON mcp_resource_subscriptions (server, subscriber_key);

CREATE INDEX IF NOT EXISTS mcp_resource_subscriptions_created
	ON mcp_resource_subscriptions (created_at);
