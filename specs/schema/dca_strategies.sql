-- spec: dca/0.1  task: 16-dca-skill
-- dca_strategies — one row per owner-configured DCA schedule.
-- dca_executions — one row per cron-triggered swap attempt.

CREATE TABLE IF NOT EXISTS dca_strategies (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id                UUID NOT NULL,
    delegation_id           UUID NOT NULL,          -- FK into agent_delegations.id
    chain_id                INTEGER NOT NULL DEFAULT 84532,
    token_in                TEXT NOT NULL,           -- USDC contract address
    token_out               TEXT NOT NULL,           -- WETH (or other whitelisted) address
    token_out_symbol        TEXT NOT NULL DEFAULT 'WETH',
    amount_per_execution    TEXT NOT NULL,           -- uint256 in token_in decimals
    period_seconds          INTEGER NOT NULL,        -- 86400=daily, 604800=weekly
    slippage_bps            INTEGER NOT NULL DEFAULT 50,
    status                  TEXT NOT NULL DEFAULT 'active',
    next_execution_at       TIMESTAMPTZ NOT NULL,
    last_execution_at       TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cancelled_at            TIMESTAMPTZ,

    CONSTRAINT dca_strategies_status_check
        CHECK (status IN ('active', 'paused', 'expired', 'cancelled')),
    CONSTRAINT dca_strategies_chain_id_check
        CHECK (chain_id > 0),
    CONSTRAINT dca_strategies_slippage_check
        CHECK (slippage_bps BETWEEN 1 AND 500),
    CONSTRAINT dca_strategies_period_check
        CHECK (period_seconds IN (86400, 604800))
);

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'dca_strategies' AND indexname = 'idx_dca_strategies_agent'
    ) THEN
        CREATE INDEX idx_dca_strategies_agent ON dca_strategies(agent_id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'dca_strategies' AND indexname = 'idx_dca_strategies_next_exec'
    ) THEN
        CREATE INDEX idx_dca_strategies_next_exec
            ON dca_strategies(next_execution_at)
            WHERE status = 'active';
    END IF;
END $$;

-- ── dca_executions ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dca_executions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_id         UUID NOT NULL REFERENCES dca_strategies(id) ON DELETE CASCADE,
    chain_id            INTEGER NOT NULL,
    tx_hash             TEXT,
    amount_in           TEXT NOT NULL,              -- actual USDC spent (wei)
    quote_amount_out    TEXT,                       -- QuoterV2 estimate (wei)
    amount_out          TEXT,                       -- actual WETH received (wei)
    slippage_bps_used   INTEGER,
    quote_divergence_bps INTEGER,                   -- abs((q2-q1)/q1 * 10000)
    status              TEXT NOT NULL DEFAULT 'pending',
    error               TEXT,
    executed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT dca_executions_status_check
        CHECK (status IN ('pending', 'success', 'failed', 'aborted'))
);

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'dca_executions' AND indexname = 'idx_dca_executions_strategy'
    ) THEN
        CREATE INDEX idx_dca_executions_strategy ON dca_executions(strategy_id);
    END IF;
END $$;
