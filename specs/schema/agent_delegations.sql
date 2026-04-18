-- spec: permissions/0.1  task: 05-db-schema
-- agent_delegations — stores ERC-7710 signed delegation envelopes.
-- Idempotent: safe to re-run against a database that already has this table.
--
-- redemption_count and last_redeemed_at are updated by the redeem endpoint
-- (task 09) via UPDATE on each successful on-chain redemption. No DB trigger
-- is needed — the redeem handler owns that write path exclusively.

CREATE TABLE IF NOT EXISTS agent_delegations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id            UUID NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
    chain_id            INTEGER NOT NULL,
    delegator_address   TEXT NOT NULL,        -- EIP-55 checksummed user wallet
    delegate_address    TEXT NOT NULL,        -- EIP-55 checksummed agent smart account
    delegation_hash     TEXT NOT NULL UNIQUE, -- keccak256 of the delegation envelope
    delegation_json     JSONB NOT NULL,       -- full signed ERC-7710 delegation envelope
    scope               JSONB NOT NULL,       -- { token, maxAmount, targets[], expiry, period }
    status              TEXT NOT NULL DEFAULT 'active',
    expires_at          TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at          TIMESTAMPTZ,
    tx_hash_revoke      TEXT,
    last_redeemed_at    TIMESTAMPTZ,
    redemption_count    INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT agent_delegations_status_check
        CHECK (status IN ('active', 'revoked', 'expired')),
    CONSTRAINT agent_delegations_chain_id_check
        CHECK (chain_id > 0),
    CONSTRAINT agent_delegations_delegator_address_check
        CHECK (LENGTH(delegator_address) = 42 AND delegator_address LIKE '0x%'),
    CONSTRAINT agent_delegations_delegate_address_check
        CHECK (LENGTH(delegate_address) = 42 AND delegate_address LIKE '0x%')
);

-- Idempotent index creation via DO blocks.
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'agent_delegations' AND indexname = 'idx_delegations_agent'
    ) THEN
        CREATE INDEX idx_delegations_agent ON agent_delegations(agent_id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'agent_delegations' AND indexname = 'idx_delegations_status'
    ) THEN
        CREATE INDEX idx_delegations_status ON agent_delegations(status) WHERE status = 'active';
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'agent_delegations' AND indexname = 'idx_delegations_delegator'
    ) THEN
        CREATE INDEX idx_delegations_delegator ON agent_delegations(delegator_address);
    END IF;
END $$;
