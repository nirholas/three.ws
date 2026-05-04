---
status: not-started
---

# Prompt 2: Create Skill Pricing Table

**Status:** Not Started

## Objective
Create a database table to store pricing information for agent skills. This is a foundational step for monetizing skills.

## Explanation
To allow agent creators to set prices for their skills, we need a dedicated table in our database. This table, `agent_skill_prices`, will link a skill to an agent and define its price and currency. We'll use a SQL migration script to create this table.

## Instructions
1.  **Create a new migration file:**
    - In your database migration tool (e.g., `node-pg-migrate`, `flyway`), create a new migration file. Name it something like `1683158400_create_agent_skill_prices.js`.

2.  **Define the table schema:**
    - The table should include the following columns:
        - `id`: Primary key (e.g., UUID or auto-incrementing integer).
        - `agent_id`: Foreign key referencing the `agents` table.
        - `skill_name`: The name of the skill (e.g., `text-to-speech`). This should match the skill identifier in the agent's definition.
        - `amount`: The price of the skill in the smallest currency unit (e.g., lamports for SOL, or cents for USD). Use a `BIGINT` to support large numbers.
        - `currency_mint`: The mint address of the currency token (e.g., the USDC mint address on Solana).
        - `created_at`: Timestamp of creation.
        - `updated_at`: Timestamp of last update.

3.  **Add constraints:**
    - Create a unique constraint on `(agent_id, skill_name)` to ensure a skill can only have one price per agent.
    - Add an index on `agent_id` for faster lookups.

4.  **Run the migration:**
    - Execute the migration to create the table in your database.

## Code Example (SQL)

```sql
CREATE TABLE agent_skill_prices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    skill_name VARCHAR(255) NOT NULL,
    amount BIGINT NOT NULL,
    currency_mint VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(agent_id, skill_name)
);

CREATE INDEX idx_agent_skill_prices_agent_id ON agent_skill_prices(agent_id);
```

## Verification
- After running the migration, connect to your database and verify that the `agent_skill_prices` table exists with the correct schema.
- You can try inserting a sample record to ensure it works as expected.
