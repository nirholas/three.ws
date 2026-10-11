-- Orders on any token, order groups, a visible order book, and one DCA store.
--
-- 1. Any SPL token. An order now names the venue it may fill on (`venue`:
--    auto|launchpad|aggregator) and records the route it was resolved to
--    (`route`): the launchpad path (pump bonding curve, then the PumpSwap AMM)
--    or the aggregator path (Jupiter, mainnet only).
-- 2. Order groups. A ladder (several take-profit legs placed in one call) and
--    an OCO pair (one fill cancels the other) share a `group_id`; `group_kind`
--    says which, `group_leg` orders the legs. `cancel_reason` says why an order
--    stopped without filling (oco_sibling_filled, owner, expired, ...).
-- 3. A visible order book. Every skipped evaluation leaves its reason on the
--    order (`last_skip_code` / `last_skip_detail` / `last_skip_at`,
--    `skip_count`), `price_band` bounds where a DCA slice may buy, and
--    `hold_until` backs an order off while its venue is unhealthy.
--    agent_order_events keeps the history: one row per change of skip reason,
--    fire, failure, cancel and expiry, never one per sweep.
-- 4. One DCA store. The delegation-signed EVM DCA schedules that lived in
--    dca_strategies move into `orders` (network 'evm', with chain_id,
--    quote_mint, amount_in_raw and delegation_id) and their attempt log into
--    order_fills, keeping every next_execution_at so no schedule skips or
--    repeats a period. The legacy tables stay in place, read by nothing, and
--    `legacy_dca_strategy_id` / `legacy_ref` make the copy idempotent; the
--    run-dca cron re-runs the same copy before each tick so a row written by an
--    older image during a rollout is adopted too (api/_lib/dca-unified.js).
-- Idempotent.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS venue                  TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS route                  TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS group_id               UUID;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS group_kind             TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS group_leg              SMALLINT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS price_band             JSONB;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS last_skip_code         TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS last_skip_detail       TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS last_skip_at           TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS skip_count             INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS hold_until             TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancel_reason          TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS chain_id               INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS quote_mint             TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS amount_in_raw          TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delegation_id          UUID;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS consecutive_failures   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS last_error_code        TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paused_at              TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS resumed_at             TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS last_fire_at           TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS legacy_dca_strategy_id UUID;

ALTER TABLE order_fills ADD COLUMN IF NOT EXISTS legacy_ref TEXT;

DO $$ BEGIN
    ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_network_check;
    ALTER TABLE orders ADD CONSTRAINT orders_network_check CHECK (network IN ('mainnet','devnet','evm'));
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_venue_check') THEN
        ALTER TABLE orders ADD CONSTRAINT orders_venue_check
            CHECK (venue IN ('auto','launchpad','aggregator','evm_delegation'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_route_check') THEN
        ALTER TABLE orders ADD CONSTRAINT orders_route_check
            CHECK (route IS NULL OR route IN ('launchpad','aggregator','evm_delegation'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_group_kind_check') THEN
        ALTER TABLE orders ADD CONSTRAINT orders_group_kind_check
            CHECK (group_kind IS NULL OR group_kind IN ('ladder','oco'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_evm_shape_check') THEN
        ALTER TABLE orders ADD CONSTRAINT orders_evm_shape_check
            CHECK (network <> 'evm' OR (chain_id IS NOT NULL AND delegation_id IS NOT NULL AND amount_in_raw IS NOT NULL));
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS orders_legacy_dca_strategy
    ON orders (legacy_dca_strategy_id) WHERE legacy_dca_strategy_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS order_fills_legacy_ref
    ON order_fills (legacy_ref) WHERE legacy_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_group
    ON orders (group_id) WHERE group_id IS NOT NULL;
-- The EVM DCA tick reads due schedules in fire order.
CREATE INDEX IF NOT EXISTS orders_evm_due
    ON orders (next_fire_at) WHERE network = 'evm' AND status = 'active';
-- One active or paused EVM schedule per agent, chain and token pair.
CREATE UNIQUE INDEX IF NOT EXISTS orders_evm_dca_one_live
    ON orders (agent_id, chain_id, lower(quote_mint), lower(mint))
    WHERE network = 'evm' AND type = 'dca' AND status IN ('active','paused');

CREATE TABLE IF NOT EXISTS agent_order_events (
    id          BIGSERIAL PRIMARY KEY,
    order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    agent_id    UUID NOT NULL,
    kind        TEXT NOT NULL,
    code        TEXT,
    detail      TEXT,
    meta        JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT agent_order_events_kind_check
        CHECK (kind IN ('placed','skip','fire','fail','cancel','expire','resume','pause'))
);
CREATE INDEX IF NOT EXISTS agent_order_events_order
    ON agent_order_events (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_order_events_agent
    ON agent_order_events (agent_id, created_at DESC);

-- Copy the delegation DCA schedules. user_id comes from the owning agent; a
-- schedule whose agent no longer exists has nobody to show it to and stays
-- behind in the legacy table.
DO $$ BEGIN
    IF to_regclass('public.dca_strategies') IS NOT NULL THEN
        INSERT INTO orders (
            agent_id, user_id, network, mint, symbol, type, side, trigger_metric,
            schedule, next_fire_at, slippage_bps, status, fill_count,
            created_at, updated_at, cancelled_at, last_error, last_error_code,
            consecutive_failures, paused_at, resumed_at, last_fire_at,
            venue, route, chain_id, quote_mint, amount_in_raw, delegation_id,
            legacy_dca_strategy_id
        )
        SELECT
            s.agent_id, a.user_id, 'evm', s.token_out, s.token_out_symbol, 'dca', 'buy', 'price_sol',
            jsonb_build_object(
                'interval_seconds', s.period_seconds,
                'slices', NULL,
                'filled_slices', (SELECT count(*) FROM dca_executions e WHERE e.strategy_id = s.id AND e.status = 'success')
            ),
            s.next_execution_at, s.slippage_bps, s.status,
            (SELECT count(*) FROM dca_executions e WHERE e.strategy_id = s.id AND e.status = 'success'),
            s.created_at, NOW(), s.cancelled_at, s.last_error, s.last_error_code,
            COALESCE(s.consecutive_failures, 0), s.paused_at, s.resumed_at, s.last_execution_at,
            'evm_delegation', 'evm_delegation', s.chain_id, s.token_in, s.amount_per_execution, s.delegation_id,
            s.id
        FROM dca_strategies s
        JOIN agent_identities a ON a.id = s.agent_id
        WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.legacy_dca_strategy_id = s.id);
    END IF;
END $$;

DO $$ BEGIN
    IF to_regclass('public.dca_executions') IS NOT NULL THEN
        INSERT INTO order_fills (
            order_id, agent_id, network, slice_index, side, trigger_reason,
            token_amount, venue, signature, status, detail, meta, created_at, legacy_ref
        )
        SELECT
            o.id, o.agent_id, 'evm', NULL, 'buy', 'dca_slice',
            CASE WHEN e.amount_out ~ '^[0-9]+$' THEN e.amount_out::numeric END,
            'evm_delegation', e.tx_hash,
            CASE e.status WHEN 'success' THEN 'confirmed' WHEN 'pending' THEN 'pending' ELSE 'failed' END,
            e.error,
            jsonb_strip_nulls(jsonb_build_object(
                'chain_id', e.chain_id,
                'amount_in', e.amount_in,
                'quote_amount_out', e.quote_amount_out,
                'amount_out', e.amount_out,
                'slippage_bps_used', e.slippage_bps_used,
                'quote_divergence_bps', e.quote_divergence_bps,
                'aborted', CASE WHEN e.status = 'aborted' THEN true END
            )),
            e.executed_at,
            'dca_execution:' || e.id::text
        FROM dca_executions e
        JOIN orders o ON o.legacy_dca_strategy_id = e.strategy_id
        WHERE NOT EXISTS (SELECT 1 FROM order_fills f WHERE f.legacy_ref = 'dca_execution:' || e.id::text);
    END IF;
END $$;
