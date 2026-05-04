# Prompt 02: Database Schema for Skill Prices

## Objective
Create the necessary database table to store pricing information for agent skills.

## Explanation
To make skills sellable, we need a way to persist their price, currency, and associated creator. This prompt establishes the foundational database schema for skill monetization. The `agent_skill_prices` table will be the single source of truth for skill pricing.

## Instructions
1.  **Locate the Schema File:**
    *   Find the main database schema definition file at `api/_lib/schema.sql`.

2.  **Define the `agent_skill_prices` Table:**
    *   Add a new `CREATE TABLE` statement to `schema.sql`.
    *   The table should include the following columns:
        *   `id`: A UUID primary key.
        *   `agent_id`: A UUID foreign key referencing `agent_identities(id)`.
        *   `skill_id`: A text field representing the unique identifier of the skill (e.g., its URI or name).
        *   `creator_id`: A UUID foreign key referencing `users(id)`, to know who gets paid.
        *   `amount`: A `BIGINT` to store the price in the smallest unit of the currency (e.g., lamports for SOL, or 10^-6 for USDC).
        *   `currency_mint`: A text field for the mint address of the currency (e.g., the USDC mint address on Solana).
        *   `created_at`, `updated_at`, `deleted_at`: Standard timestamp columns.

3.  **Add an Index:**
    *   Create a unique index on `(agent_id, skill_id)` to ensure a skill on a specific agent can only have one price.

## SQL Example

```sql
-- In api/_lib/schema.sql

CREATE TABLE agent_skill_prices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
    skill_id TEXT NOT NULL,
    creator_id UUID NOT NULL REFERENCES users(id),
    amount BIGINT NOT NULL CHECK (amount > 0),
    currency_mint TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_agent_skill_prices_one_price_per_skill
ON agent_skill_prices (agent_id, skill_id)
WHERE deleted_at IS NULL;

CREATE INDEX idx_agent_skill_prices_creator_id ON agent_skill_prices(creator_id);
```
