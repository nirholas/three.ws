-- Sniper moon-bag manager state and per-stage latency telemetry.
--
-- 1. Moon bags retained by a terminal profitable exit sat in the wallet forever:
--    nothing re-quoted them. The manager (workers/agent-sniper/moonbag-manager.js)
--    needs a high-water mark, a stale clock and a close record per bag.
-- 2. Backtests need a real price series and a signal-to-fill latency breakdown.
--
-- Additive and idempotent. Not applied by the agent that wrote it: `npm run
-- db:status` first, then `npm run db:migrate` (it applies immediately).

ALTER TABLE agent_sniper_positions
	ADD COLUMN IF NOT EXISTS moonbag_peak_value_lamports NUMERIC(40, 0) NOT NULL DEFAULT 0,
	ADD COLUMN IF NOT EXISTS moonbag_stale_since         TIMESTAMPTZ,
	ADD COLUMN IF NOT EXISTS moonbag_closed_at           TIMESTAMPTZ,
	ADD COLUMN IF NOT EXISTS moonbag_exit_reason         TEXT,
	ADD COLUMN IF NOT EXISTS moonbag_exit_sig            TEXT,
	ADD COLUMN IF NOT EXISTS moonbag_exit_lamports       NUMERIC(40, 0),
	ADD COLUMN IF NOT EXISTS moonbag_error               TEXT,
	ADD COLUMN IF NOT EXISTS signal_seen_at              TIMESTAMPTZ,
	ADD COLUMN IF NOT EXISTS decision_at                 TIMESTAMPTZ,
	ADD COLUMN IF NOT EXISTS sent_at                     TIMESTAMPTZ,
	ADD COLUMN IF NOT EXISTS landed_at                   TIMESTAMPTZ;

COMMENT ON COLUMN agent_sniper_positions.moonbag_peak_value_lamports IS
	'High-water mark of the retained bag''s quoted SOL value. The manager trails its stop from this.';
COMMENT ON COLUMN agent_sniper_positions.moonbag_stale_since IS
	'Start of the dust-and-unchanged clock; a bag stale past SNIPER_MOONBAG_WRITE_OFF_S is written off instead of quoted forever.';
COMMENT ON COLUMN agent_sniper_positions.moonbag_exit_reason IS
	'Why the manager closed the bag: trailing_stop | take_profit | written_off. NULL while the bag still rides.';
COMMENT ON COLUMN agent_sniper_positions.signal_seen_at IS
	'When the feed event that triggered the entry reached the worker (new_mint feed only; NULL for other triggers).';
COMMENT ON COLUMN agent_sniper_positions.decision_at IS 'When executeBuy took the agent lock and began deciding.';
COMMENT ON COLUMN agent_sniper_positions.sent_at IS 'Immediately before the entry transaction was broadcast (live only).';
COMMENT ON COLUMN agent_sniper_positions.landed_at IS 'When the entry transaction confirmed (live only).';

-- Bags the manager still has to look after, oldest quote first.
CREATE INDEX IF NOT EXISTS idx_sniper_positions_moonbag_active
	ON agent_sniper_positions (network, moonbag_last_quoted_at NULLS FIRST)
	WHERE moonbag_base_amount > 0 AND moonbag_closed_at IS NULL;

-- One row per sampled quote of an open position (or a retained bag). Sampled at
-- most once per second per position; retained 14 days (api/_lib/db-archive-tables.js).
CREATE TABLE IF NOT EXISTS agent_sniper_price_ticks (
	id                       BIGSERIAL PRIMARY KEY,
	position_id              UUID        NOT NULL,
	mint                     TEXT        NOT NULL,
	network                  TEXT        NOT NULL,
	ts                       TIMESTAMPTZ NOT NULL DEFAULT now(),
	value_lamports           NUMERIC(40, 0) NOT NULL,
	price_lamports_per_token DOUBLE PRECISION,
	source                   TEXT        NOT NULL CHECK (source IN ('position', 'moonbag', 'candidate'))
);

-- The archive-then-prune cron pages by (ts, id); this index leads with ts.
CREATE INDEX IF NOT EXISTS idx_sniper_price_ticks_ts ON agent_sniper_price_ticks (ts, id);
CREATE INDEX IF NOT EXISTS idx_sniper_price_ticks_position ON agent_sniper_price_ticks (position_id, ts);
