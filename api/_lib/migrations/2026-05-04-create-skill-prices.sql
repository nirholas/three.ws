CREATE TABLE agent_skill_prices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount BIGINT NOT NULL,
    currency_mint VARCHAR(44) NOT NULL, -- Solana public key length
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- A skill should only have one price set by its creator
    UNIQUE (skill_id, creator_id)
);

-- Create an index for efficient price lookups by skill
CREATE INDEX idx_agent_skill_prices_on_skill_id ON agent_skill_prices(skill_id);

-- Optional: Trigger to auto-update updated_at timestamp
CREATE TRIGGER set_timestamp
BEFORE UPDATE ON agent_skill_prices
FOR EACH ROW
EXECUTE PROCEDURE trigger_set_timestamp();
