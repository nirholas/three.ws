-- Durable store for the grind-bounty market. These records used to live only in
-- Redis (a hash plus sorted sets), so an eviction or flush lost escrow, payout
-- and refund history. Postgres is now the source of truth.
--
-- `record` is the full bounty document (the same JSON the Redis hash held); the
-- scalar columns are the fields the board, the claim queue and the stats read,
-- kept in step by the store's single-statement transitions.

CREATE TABLE IF NOT EXISTS vanity_bounties (
	id                     TEXT PRIMARY KEY,
	status                 TEXT NOT NULL,
	record                 JSONB NOT NULL,
	created_at             BIGINT NOT NULL,
	expires_at             BIGINT,
	amount_atomics         BIGINT NOT NULL DEFAULT 0,
	payout_tx              TEXT,
	payout_worker_id       TEXT,
	payout_amount_atomics  BIGINT,
	refund_tx              TEXT
);

CREATE INDEX IF NOT EXISTS vanity_bounties_status_expiry ON vanity_bounties (status, expires_at);
CREATE INDEX IF NOT EXISTS vanity_bounties_created ON vanity_bounties (created_at DESC);
CREATE INDEX IF NOT EXISTS vanity_bounties_payout_worker ON vanity_bounties (payout_worker_id) WHERE payout_worker_id IS NOT NULL;

-- Append-only audit trail of every state change (created, activated, voided,
-- settled, refundable, payout, refund). Event data never holds the sealed secret.
CREATE TABLE IF NOT EXISTS vanity_bounty_events (
	id         BIGSERIAL PRIMARY KEY,
	bounty_id  TEXT NOT NULL REFERENCES vanity_bounties(id) ON DELETE CASCADE,
	kind       TEXT NOT NULL,
	at         BIGINT NOT NULL,
	data       JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS vanity_bounty_events_bounty ON vanity_bounty_events (bounty_id, id);
