-- migrations/002_create_agent_skill_prices.sql

CREATE TABLE agent_skill_prices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id),
    skill_name VARCHAR(128) NOT NULL,
    amount NUMERIC(20, 0) NOT NULL CHECK (amount >= 0),
    currency_mint VARCHAR(64) NOT NULL,
    creator_user_id UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (agent_id, skill_name)
);

CREATE INDEX idx_agent_skill_prices_agent_id ON agent_skill_prices(agent_id);
CREATE INDEX idx_agent_skill_prices_skill_name ON agent_skill_prices(skill_name);

COMMENT ON TABLE agent_skill_prices IS 'Stores prices for agent skills set by creators.';
COMMENT ON COLUMN agent_skill_prices.amount IS 'Price in the smallest unit of the currency (e.g., lamports).';
