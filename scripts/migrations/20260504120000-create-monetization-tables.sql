-- migration-20260504120000-create-monetization-tables.sql
-- This migration creates the tables necessary for agent skill monetization.

-- Table to store the prices for agent skills, set by the agent creator.
CREATE TABLE agent_skill_prices (
    agent_id BIGINT NOT NULL,
    skill_name VARCHAR(255) NOT NULL,
    amount BIGINT NOT NULL CHECK (amount > 0),
    currency_mint VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (agent_id, skill_name),
    -- Assuming a foreign key relationship to an 'agents' table.
    -- If your agents table has a different name or primary key, adjust accordingly.
    CONSTRAINT fk_agent
        FOREIGN KEY(agent_id) 
        REFERENCES agents(id)
        ON DELETE CASCADE
);

-- Index for faster queries when fetching all priced skills for a given agent.
CREATE INDEX idx_agent_skill_prices_agent_id ON agent_skill_prices(agent_id);

-- Table to record successful purchases of skills by users.
CREATE TABLE user_skill_purchases (
    user_id BIGINT NOT NULL,
    agent_id BIGINT NOT NULL,
    skill_name VARCHAR(255) NOT NULL,
    purchase_tx_signature VARCHAR(255) NOT NULL,
    amount_paid BIGINT NOT NULL,
    currency_mint VARCHAR(255) NOT NULL,
    purchased_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, agent_id, skill_name),
    -- Assuming foreign key relationships to 'users' and 'agents' tables.
    -- Adjust if your table names or primary keys are different.
    CONSTRAINT fk_user
        FOREIGN KEY(user_id) 
        REFERENCES users(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_agent
        FOREIGN KEY(agent_id) 
        REFERENCES agents(id)
        ON DELETE CASCADE
);

-- Indexes for common query patterns.
CREATE INDEX idx_user_skill_purchases_user_id ON user_skill_purchases(user_id);
CREATE UNIQUE INDEX idx_user_skill_purchases_tx_signature ON user_skill_purchases(purchase_tx_signature);

-- A function to automatically update the updated_at timestamp on row modification.
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- A trigger to execute the function before any update on agent_skill_prices.
CREATE TRIGGER update_agent_skill_prices_modtime
    BEFORE UPDATE ON agent_skill_prices
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_column();
