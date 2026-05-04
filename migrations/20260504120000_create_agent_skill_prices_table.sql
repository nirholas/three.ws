-- Up
CREATE TABLE agent_skill_prices (
  id SERIAL PRIMARY KEY,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  skill_name VARCHAR(255) NOT NULL,
  amount BIGINT NOT NULL, -- Price in the smallest denomination (e.g., lamports)
  currency_mint VARCHAR(255) NOT NULL, -- SPL Token mint address
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_agent_skill UNIQUE (agent_id, skill_name)
);

-- Optional: Create a trigger to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_timestamp
BEFORE UPDATE ON agent_skill_prices
FOR EACH ROW
EXECUTE PROCEDURE trigger_set_timestamp();

-- Down
DROP TABLE agent_skill_prices;
DROP FUNCTION trigger_set_timestamp();
