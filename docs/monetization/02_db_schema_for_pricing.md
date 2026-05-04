---
status: not-started
last_updated: 2026-05-04
---
# Prompt 02: Database Schema for Skill Pricing

## Objective
Create the necessary database table to store prices for agent skills.

## Explanation
To allow creators to set prices for their skills, we need a dedicated table in our PostgreSQL database. This table will link an agent, a skill, and a price, defined by an amount and a currency. This structure allows for future flexibility, such as supporting multiple currencies.

## Instructions
1.  **Design the Table:**
    *   Create a new table named `agent_skill_prices`.
    *   The table should have the following columns:
        *   `id`: Primary key (e.g., UUID or SERIAL).
        *   `agent_id`: Foreign key referencing the `agent_identities` table.
        *   `skill_name`: A text field to identify the skill. It should match the name defined in the agent's manifest.
        *   `amount`: A numeric or bigint type to store the price in the smallest denomination of the currency (e.g., lamports for Solana tokens).
        *   `currency_mint`: A text field to store the mint address of the currency (e.g., the USDC mint address on Solana).
        *   `created_at`: Timestamp of creation.
        *   `updated_at`: Timestamp of the last update.
    *   Add a unique constraint on (`agent_id`, `skill_name`) to ensure a skill only has one price per agent.

2.  **Write the SQL Migration:**
    *   Create a new SQL migration file.
    *   Write the `CREATE TABLE` statement according to the design above.
    *   Include commands to create indexes on `agent_id` for efficient lookups.

## SQL Example

Here is the PostgreSQL `CREATE TABLE` statement.

```sql
CREATE TABLE IF NOT EXISTS agent_skill_prices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL,
    skill_name VARCHAR(255) NOT NULL,
    amount BIGINT NOT NULL CHECK (amount > 0),
    currency_mint VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_agent
        FOREIGN KEY(agent_id)
        REFERENCES agent_identities(id)
        ON DELETE CASCADE,

    UNIQUE (agent_id, skill_name)
);

CREATE INDEX idx_agent_skill_prices_agent_id ON agent_skill_prices(agent_id);

-- Optional: Create a trigger to auto-update updated_at timestamp
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

```
