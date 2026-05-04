
-- Migration to create the agent_skill_prices table

CREATE TABLE IF NOT EXISTS agent_skill_prices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    skill_id UUID NOT NULL,
    creator_id UUID NOT NULL,
    amount BIGINT NOT NULL,
    currency_mint VARCHAR(44) NOT NULL, -- Solana public key length
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- A skill should only have one price set by its creator
    UNIQUE (skill_id, creator_id)
);

-- Create an index for efficient price lookups by skill
CREATE INDEX IF NOT EXISTS idx_agent_skill_prices_on_skill_id ON agent_skill_prices(skill_id);
      