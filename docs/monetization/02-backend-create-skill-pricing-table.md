---
status: not-started
---

# Prompt 2: Backend - Create Skill Pricing Table

## Objective
Design and create the necessary database table to store pricing information for agent skills. This is a foundational step for all monetization features.

## Explanation
To make skills purchasable, we need a dedicated table in our PostgreSQL database (`agent_skill_prices`) that links a skill to an agent, and specifies its price and currency. This table will be the source of truth for all skill pricing on the platform.

## Instructions
1.  **Design the Table Schema:**
    *   The table should be named `agent_skill_prices`.
    *   It needs columns to link to the agent (`agent_id`) and to identify the skill (`skill_id` or `skill_name`). Using `skill_name` (e.g., a `TEXT` or `VARCHAR` field) can simplify lookups, assuming skill names are unique per agent.
    *   It must have a column for the price amount (e.g., `amount` as `BIGINT` to store lamports or other smallest currency units).
    *   It must have a column for the currency (e.g., `currency_mint` as `TEXT` to store the Solana mint address of the currency, like USDC).
    *   Add a primary key and foreign key constraints to `agent_identities`.
    *   Create a unique constraint on (`agent_id`, `skill_name`) to prevent duplicate price entries for the same skill on the same agent.

2.  **Create a SQL Migration File:**
    *   Create a new SQL file in a migrations directory (if one exists, otherwise you can place it in `scripts/migrations/`).
    *   Write the `CREATE TABLE` statement for `agent_skill_prices`.
    *   Include standard columns like `created_at` and `updated_at`.

## Code Example (SQL)

```sql
-- scripts/migrations/002_create_agent_skill_prices.sql

CREATE TABLE IF NOT EXISTS agent_skill_prices (
    id SERIAL PRIMARY KEY,
    agent_id INTEGER NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
    skill_name VARCHAR(255) NOT NULL,
    -- Price in the smallest denomination (e.g., lamports for SOL, or 10^-6 for USDC)
    amount BIGINT NOT NULL CHECK (amount >= 0),
    -- The mint address of the currency token (e.g., USDC, BONK, etc.)
    currency_mint VARCHAR(44) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- An agent can only have one price per skill.
    UNIQUE (agent_id, skill_name)
);

-- Optional: Create an index for faster lookups
CREATE INDEX IF NOT EXISTS idx_agent_skill_prices_agent_id ON agent_skill_prices(agent_id);

-- Optional: Add a trigger to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_timestamp
BEFORE UPDATE ON agent_skill_prices
FOR EACH ROW
EXECUTE PROCEDURE set_updated_at_timestamp();
```
