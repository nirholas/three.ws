# Prompt 4: Design Database Schema for Skill Pricing

## Status
- [ ] Not Started

## Objective
Design and create the necessary database table(s) to store pricing information for agent skills.

## Explanation
To make skills purchasable, we need a persistent storage solution for their pricing details. This prompt outlines the creation of an `agent_skill_prices` table that will link skills to their price and currency.

## Instructions
1.  **Define the Schema:**
    *   Create a new table named `agent_skill_prices`.
    *   The table should include the following columns:
        *   `id`: Primary key (e.g., UUID or auto-incrementing integer).
        *   `agent_id`: Foreign key referencing the `agents` table.
        *   `skill_name`: The name of the skill (e.g., "super-jump"). This should match the skill name defined in the agent's configuration.
        *   `amount`: The price of the skill in the smallest unit of the currency (e.g., lamports for SOL, or the base unit for USDC). Use a data type that can handle large numbers (e.g., `BIGINT` or `NUMERIC`).
        *   `currency_mint`: The mint address of the SPL token used for payment (e.g., the USDC mint address).
        *   `created_at`, `updated_at`: Timestamps for record management.

2.  **Write the SQL Migration:**
    *   Create a new SQL migration file to apply this schema change to the database.
    *   Include `CREATE TABLE` and `CREATE INDEX` statements. It's recommended to create an index on `(agent_id, skill_name)` for quick lookups.

## SQL Example (PostgreSQL)
```sql
-- migration-002-create-agent-skill-prices.sql

CREATE TABLE agent_skill_prices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    skill_name VARCHAR(255) NOT NULL,
    amount BIGINT NOT NULL,
    currency_mint VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_agent_skill_prices_on_agent_and_skill 
ON agent_skill_prices (agent_id, skill_name);

COMMENT ON COLUMN agent_skill_prices.amount IS 'Price in the smallest currency unit (e.g., lamports)';
COMMENT ON COLUMN agent_skill_prices.currency_mint IS 'Mint address of the SPL token for payment';
```
