-- Durable webhook delivery for the v1 agents API.
--
-- Developer webhooks used to retry three times inside the request that raised
-- the event (1s, 4s, 16s), writing one webhook_deliveries row per attempt. A
-- receiver that was down for a minute lost the event for good, and a process
-- that recycled mid-retry dropped it silently.
--
-- From here on a delivery is ONE row per (endpoint, event) that moves through
-- pending -> delivering -> succeeded | failed. Every HTTP attempt is appended
-- to `attempts`. A failed attempt reschedules the row with backoff in
-- `next_attempt_at`; the every-minute cron (api/cron/webhook-deliveries.js)
-- picks up whatever is due, and `lease_until` keeps two workers from posting
-- the same row at once. A replay is a fresh row pointing at its original
-- through `replay_of`. Rows written before this migration keep status NULL
-- and still read as one-row-per-attempt history.
--
-- Service layer: api/_lib/webhook-dispatch.js. Routes: /api/v1/webhooks
-- (api/v1/rest.js) and /api/developer/webhooks.

-- An endpoint can be narrowed to one agent: agent-scoped events (run.finished,
-- automation.fired, message.received, approval.needed) for any other agent are
-- not delivered to it. NULL means every agent the account owns.
ALTER TABLE developer_webhooks ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES agent_identities(id) ON DELETE CASCADE;
ALTER TABLE developer_webhooks ADD COLUMN IF NOT EXISTS consecutive_failures int NOT NULL DEFAULT 0;
ALTER TABLE developer_webhooks ADD COLUMN IF NOT EXISTS disabled_reason text;
ALTER TABLE developer_webhooks ADD COLUMN IF NOT EXISTS last_success_at timestamptz;
ALTER TABLE developer_webhooks ADD COLUMN IF NOT EXISTS last_failure_at timestamptz;

CREATE INDEX IF NOT EXISTS developer_webhooks_user_created
	ON developer_webhooks (user_id, created_at DESC, id DESC);

ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS lease_until timestamptz;
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS attempts jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS duration_ms int;
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS replay_of uuid REFERENCES webhook_deliveries(id) ON DELETE SET NULL;
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$ BEGIN
	ALTER TABLE webhook_deliveries ADD CONSTRAINT webhook_deliveries_status_check
		CHECK (status IS NULL OR status IN ('pending', 'delivering', 'succeeded', 'failed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- One original delivery per endpoint per event: an event raised twice (a
-- retried cron, a re-polled approval) can never post twice. Replays and the
-- legacy per-attempt rows are outside the constraint.
CREATE UNIQUE INDEX IF NOT EXISTS webhook_deliveries_event_once
	ON webhook_deliveries (webhook_id, event_id)
	WHERE status IS NOT NULL AND replay_of IS NULL;

-- The retry sweep reads only what is due.
CREATE INDEX IF NOT EXISTS webhook_deliveries_due
	ON webhook_deliveries (next_attempt_at)
	WHERE status = 'pending';

-- A worker that died holding a lease is found by this.
CREATE INDEX IF NOT EXISTS webhook_deliveries_leased
	ON webhook_deliveries (lease_until)
	WHERE status = 'delivering';

-- The delivery log pages newest first by (created_at, id).
CREATE INDEX IF NOT EXISTS webhook_deliveries_webhook_page
	ON webhook_deliveries (webhook_id, created_at DESC, id DESC);
