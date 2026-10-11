-- Event Markets auto-open (brief 04): idempotency guarantees, the skip log and the outbox.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261012010000_event_market_auto_open.sql
-- Idempotent. Docs: docs/event-markets.md ("Which events get a market").

-- One market per event, one outcome per entrant. Repeated here so the guarantee holds
-- whichever of the core migrations created the tables first.
CREATE UNIQUE INDEX IF NOT EXISTS event_markets_source_uidx
	ON event_markets (source_kind, source_ref) WHERE source_ref IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS event_market_outcomes_ref_uidx
	ON event_market_outcomes (market_id, ref_kind, ref_id) WHERE ref_id IS NOT NULL;

-- Events the cron looked at and declined, and why, so the owner can see every event
-- that has no market. One row per event; opening a market for it deletes the row.
CREATE TABLE IF NOT EXISTS event_market_skips (
	source_kind  text NOT NULL,
	source_ref   text NOT NULL,
	title        text NOT NULL,
	reason       text NOT NULL CHECK (reason IN ('too_few_entrants', 'no_defined_winner', 'lock_passed')),
	detail       text,
	first_seen   timestamptz NOT NULL DEFAULT now(),
	last_seen    timestamptz NOT NULL DEFAULT now(),
	seen_count   int NOT NULL DEFAULT 1,
	PRIMARY KEY (source_kind, source_ref)
);

-- Outbox. Features that react to a market (announcement drafts, notifications) read
-- rows from here instead of being called in-process, so they stay independent of
-- this one. `processed_at` belongs to the consumer.
CREATE TABLE IF NOT EXISTS event_market_outbox (
	id            bigserial PRIMARY KEY,
	kind          text NOT NULL,
	market_id     uuid NOT NULL REFERENCES event_markets(id) ON DELETE CASCADE,
	payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at    timestamptz NOT NULL DEFAULT now(),
	processed_at  timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS event_market_outbox_once_uidx ON event_market_outbox (kind, market_id);
CREATE INDEX IF NOT EXISTS event_market_outbox_pending_idx ON event_market_outbox (created_at) WHERE processed_at IS NULL;
