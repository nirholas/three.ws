# Prompt 8: Database Schema for Skill Pricing and Ownership

**Status:** - [ ] Not Started

## Objective
Design and create the necessary SQL table schemas to store skill prices and user skill ownership.

## Explanation
A robust backend requires a well-defined database structure. This prompt outlines the schemas for two key tables: one to define the prices of skills set by creators, and another to track which users have purchased which skills.

## Instructions
1.  **Design `agent_skill_prices` Table:**
    *   This table will store the price for each monetized skill of an agent.
    *   **Columns:**
        *   `id`: Primary key (e.g., UUID or auto-incrementing integer).
        *   `agent_id`: Foreign key to the `agents` table.
        *   `skill_name`: The name of the skill (e.g., 'sentiment-analysis').
        *   `amount`: The price in the smallest denomination of the currency (e.g., lamports for SOL, or 10^-6 for USDC). Use a `bigint` for this.
        *   `currency_mint`: The public key of the SPL token mint used for the currency (e.g., USDC mint address).
        *   `creator_address`: The Solana address where funds should be sent.
        *   `created_at`, `updated_at`: Timestamps.
    *   Create a unique constraint on (`agent_id`, `skill_name`).

2.  **Design `user_agent_skills` Table:**
    *   This table will link users to the skills they've purchased.
    *   **Columns:**
        *   `id`: Primary key.
        *   `user_id`: Foreign key to the `users` table.
        *   `agent_id`: Foreign key to the `agents` table.
        *   `skill_name`: The name of the purchased skill.
        *   `purchase_tx_signature`: The Solana transaction signature of the purchase.
        *   `created_at`: Timestamp.
    *   Create a unique constraint on (`user_id`, `agent_id`, `skill_name`).

3.  **Create Migration File:**
    *   Write the SQL `CREATE TABLE` statements for both tables in a new migration file. The project seems to have a migration system in `scripts/apply-migrations.mjs`, so follow that pattern.

## SQL Example (for a PostgreSQL database)

```sql
-- In a new migration file in your migrations directory

CREATE TABLE agent_skill_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  skill_name VARCHAR(255) NOT NULL,
  amount BIGINT NOT NULL,
  currency_mint VARCHAR(255) NOT NULL,
  creator_address VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agent_id, skill_name)
);

CREATE TABLE user_agent_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  skill_name VARCHAR(255) NOT NULL,
  purchase_tx_signature VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, agent_id, skill_name)
);

-- It's good practice to create indexes for foreign keys
CREATE INDEX idx_agent_skill_prices_agent_id ON agent_skill_prices(agent_id);
CREATE INDEX idx_user_agent_skills_user_id ON user_agent_skills(user_id);
CREATE INDEX idx_user_agent_skills_agent_id ON user_agent_skills(agent_id);
```
