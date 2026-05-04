-- Create the agent_skill_prices table
CREATE TABLE IF NOT EXISTS agent_skill_prices (
    agent_id UUID NOT NULL,
    skill_name VARCHAR(255) NOT NULL,
    amount BIGINT NOT NULL,
    currency_mint VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (agent_id, skill_name),
    FOREIGN KEY (agent_id) REFERENCES agent_identities(id) ON DELETE CASCADE
);

-- Create a trigger function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ language 'plpgsql';

-- Create a trigger that uses the function
CREATE TRIGGER update_agent_skill_prices_updated_at
BEFORE UPDATE ON agent_skill_prices
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
