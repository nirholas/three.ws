-- Up
CREATE TABLE agent_skill_prices (
  agent_id UUID NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
  skill_name VARCHAR(255) NOT NULL,
  amount BIGINT NOT NULL,
  currency_mint VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (agent_id, skill_name)
);

CREATE INDEX idx_agent_skill_prices_agent_id ON agent_skill_prices(agent_id);

-- Down
DROP TABLE IF EXISTS agent_skill_prices;
