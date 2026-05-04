CREATE TABLE IF NOT EXISTS agent_skill_prices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    skill_name VARCHAR(255) NOT NULL,
    amount BIGINT NOT NULL,
    currency_mint VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (agent_id, skill_name)
);

CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_agent_skill_prices_updated_at
BEFORE UPDATE ON agent_skill_prices
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();
