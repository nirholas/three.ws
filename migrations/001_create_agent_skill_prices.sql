-- Migration to create the agent_skill_prices table

CREATE TABLE IF NOT EXISTS agent_skill_prices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    skill_name VARCHAR(255) NOT NULL,
    amount BIGINT NOT NULL, -- Storing price in the smallest currency unit (e.g., lamports for SOL)
    currency_mint VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (agent_id, skill_name)
);

-- Create an index for faster lookups by agent_id
CREATE INDEX IF NOT EXISTS idx_agent_skill_prices_agent_id ON agent_skill_prices(agent_id);

-- A function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- A trigger to call the function before any update
CREATE TRIGGER set_timestamp
BEFORE UPDATE ON agent_skill_prices
FOR EACH ROW
EXECUTE PROCEDURE trigger_set_timestamp();

COMMENT ON TABLE agent_skill_prices IS 'Stores the prices for skills associated with an agent.';
COMMENT ON COLUMN agent_skill_prices.amount IS 'Price in the smallest unit of the currency (e.g., lamports).';
