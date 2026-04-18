-- spec: permissions/0.1  task: 15-skill-subscription
-- agent_subscriptions — recurring on-chain payment schedule backed by an ERC-7710 delegation.
-- Idempotent: safe to re-run against a database that already has this table.
--
-- The cron at api/cron/run-subscriptions selects rows WHERE status='active' AND
-- next_charge_at <= NOW(), fires onPeriod, then advances next_charge_at by
-- period_seconds. On failure it sets status='paused' + last_error.
--
-- Cancellation (DELETE /api/subscriptions) sets status='canceled' but does NOT
-- revoke the underlying delegation — revocation is a separate user action.

CREATE TABLE IF NOT EXISTS agent_subscriptions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id            UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    delegation_id       UUID NOT NULL REFERENCES agent_delegations(id) ON DELETE CASCADE,
    period_seconds      INTEGER NOT NULL,
    amount_per_period   TEXT NOT NULL,              -- base units, string (≤ delegation scope.maxAmount)
    next_charge_at      TIMESTAMPTZ NOT NULL,
    last_charge_at      TIMESTAMPTZ,
    status              TEXT NOT NULL DEFAULT 'active',
    last_error          TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    canceled_at         TIMESTAMPTZ,

    CONSTRAINT agent_subscriptions_status_check
        CHECK (status IN ('active', 'canceled', 'paused')),
    CONSTRAINT agent_subscriptions_period_seconds_check
        CHECK (period_seconds > 0)
);

-- Partial index for the cron hot path: only active rows ordered by charge time.
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'agent_subscriptions' AND indexname = 'idx_subscriptions_due'
    ) THEN
        CREATE INDEX idx_subscriptions_due
            ON agent_subscriptions(next_charge_at)
            WHERE status = 'active';
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'agent_subscriptions' AND indexname = 'idx_subscriptions_user'
    ) THEN
        CREATE INDEX idx_subscriptions_user ON agent_subscriptions(user_id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'agent_subscriptions' AND indexname = 'idx_subscriptions_agent'
    ) THEN
        CREATE INDEX idx_subscriptions_agent ON agent_subscriptions(agent_id);
    END IF;
END $$;
