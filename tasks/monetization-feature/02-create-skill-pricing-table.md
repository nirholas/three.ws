---
title: "Prompt 2: Create `agent_skill_prices` Table Schema"
status: "completed"
---

# Prompt 2: Create `agent_skill_prices` Table Schema

**Status:** Completed

## Objective
Define and create the necessary database table to store skill prices set by agent creators.

## Explanation
Before creators can set prices, we need a place in our database to store this information. This task involves creating a new table, `agent_skill_prices`, that will link an agent and a skill to a specific price in a specific currency. This forms the backbone of our pricing system.

## Instructions
1.  **Locate the schema definition file:** Find the main `schema.sql` file, likely located at `api/_lib/schema.sql`.
2.  **Define the `agent_skill_prices` table:** Add a new `CREATE TABLE` statement to this file. The table should include:
    *   `agent_id`: A foreign key referencing the `agents` table.
    *   `skill_id`: A string identifier for the skill (e.g., "weather-api", "translation-pro").
    *   `amount`: A `BIGINT` to store the price in the smallest denomination of the currency (e.g., lamports for SOL, or 10^-6 for USDC). Using a `BIGINT` avoids floating-point precision issues.
    *   `currency_mint`: The public key (as a string) of the SPL token mint for the currency (e.g., `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyB7u6T` for USDC on Solana Mainnet).
    *   A primary key combining `agent_id` and `skill_id` to ensure each skill on an agent has only one price.
    *   Timestamps (`created_at`, `updated_at`).
3.  **Apply the schema:** Run the updated `schema.sql` against your local database to create the table.

## Code Example (`api/_lib/schema.sql`)

```sql
-- ... other table definitions

-- Stores prices for agent skills, set by the agent's creator.
CREATE TABLE IF NOT EXISTS agent_skill_prices (
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    skill_id TEXT NOT NULL,
    amount BIGINT NOT NULL CHECK (amount > 0),
    currency_mint TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (agent_id, skill_id)
);

-- Index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_agent_skill_prices_agent_id ON agent_skill_prices(agent_id);

-- Auto-update the 'updated_at' column
-- This assumes a 'trigger_set_timestamp' function is already defined in your database.
CREATE TRIGGER set_timestamp
BEFORE UPDATE ON agent_skill_prices
FOR EACH ROW
EXECUTE PROCEDURE trigger_set_timestamp();

```
