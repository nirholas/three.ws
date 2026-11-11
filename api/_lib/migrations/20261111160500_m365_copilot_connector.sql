-- Microsoft 365 Copilot connector: one Microsoft Graph externalConnection per
-- three.ws account, in the Microsoft 365 tenant whose admin granted consent,
-- plus the ledger of every item three.ws has pushed into it.
--
-- Library: api/_lib/m365-connector.js. Docs: docs/microsoft-365-copilot-connector.md.
--
-- status walks consented -> provisioning -> schema_pending -> ready; error
-- holds the last failure with an admin-readable fix in last_error. The sync
-- cursor is (cursor_updated_at, cursor_item_id): every item at or before it has
-- been pushed in order. next_attempt_at is set from Graph's Retry-After when a
-- run is throttled, and the cron skips the connection until then.

CREATE TABLE IF NOT EXISTS m365_connections (
	user_id               uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
	tenant_id             uuid NOT NULL,
	connection_id         text NOT NULL,
	status                text NOT NULL DEFAULT 'consented'
	                      CHECK (status IN ('consented', 'provisioning', 'schema_pending', 'ready', 'error')),
	audience              text NOT NULL DEFAULT 'organization'
	                      CHECK (audience IN ('organization', 'group', 'owner')),
	group_id              uuid,
	include_private       boolean NOT NULL DEFAULT false,
	schema_version        int,
	schema_operation_url  text,
	cursor_updated_at     timestamptz,
	cursor_item_id        text,
	items_indexed         int NOT NULL DEFAULT 0,
	last_sync_started_at  timestamptz,
	last_sync_at          timestamptz,
	last_full_sync_at     timestamptz,
	last_error            text,
	last_error_code       text,
	last_error_at         timestamptz,
	next_attempt_at       timestamptz,
	connected_at          timestamptz NOT NULL DEFAULT now(),
	updated_at            timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT m365_connections_tenant_connection UNIQUE (tenant_id, connection_id),
	CONSTRAINT m365_connections_group_audience CHECK (audience <> 'group' OR group_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS m365_connections_due_idx ON m365_connections (status, next_attempt_at);

CREATE TABLE IF NOT EXISTS m365_connector_items (
	user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	item_id            text NOT NULL,
	kind               text NOT NULL CHECK (kind IN ('agent', 'model', 'avatar')),
	content_hash       text NOT NULL,
	source_updated_at  timestamptz NOT NULL,
	synced_at          timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (user_id, item_id)
);
