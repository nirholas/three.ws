---
status: not-started
completed_at: null
---
# Prompt 1: Database Schema for Skill Monetization

## Objective
Design and create the necessary database tables to support pricing skills and tracking user purchases.

## Explanation
To monetize agent skills, we first need a robust database structure. This involves creating two primary tables: one to store the prices set by creators for their agent skills (`agent_skill_prices`) and another to record which users have purchased which skills (`user_skill_purchases`). This foundational schema is critical for all subsequent monetization features.

## Instructions
1.  **Design the Schema:**
    *   **`agent_skill_prices` table:**
        *   `agent_id`: Foreign key to the `agents` table.
        *   `skill_name`: The name of the skill being priced (e.g., "translate", "summarize-document").
        *   `amount`: The price of the skill in the smallest unit of the currency (e.g., lamports for SOL, or 10^-6 for USDC). Use a `bigint` for precision.
        *   `currency_mint`: The mint address of the SPL token for the price (e.g., `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyB7u6f` for USDC).
        *   `created_at`, `updated_at`: Standard timestamps.
        *   Define a composite primary key on `(agent_id, skill_name)`.
    *   **`user_skill_purchases` table:**
        *   `user_id`: Foreign key to the `users` table.
        *   `agent_id`: Foreign key to the `agents` table.
        *   `skill_name`: The name of the purchased skill.
        *   `purchase_tx_signature`: The transaction signature from the on-chain payment.
        *   `amount_paid`, `currency_mint`: The actual price paid.
        *   `purchased_at`: Timestamp of the purchase.
        *   Define a composite primary key on `(user_id, agent_id, skill_name)`.

2.  **Write the SQL Migration:**
    *   Create a new SQL migration file in your migrations directory.
    *   Write the `CREATE TABLE` statements for both tables designed above.
    *   Include appropriate indexing for foreign keys to ensure query performance.

## Example SQL Migration

```sql
-- migration-YYYYMMDDHHMMSS-create-monetization-tables.sql

CREATE TABLE agent_skill_prices (
    agent_id BIGINT NOT NULL,
    skill_name VARCHAR(255) NOT NULL,
    amount BIGINT NOT NULL,
    currency_mint VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (agent_id, skill_name),
    CONSTRAINT fk_agent
        FOREIGN KEY(agent_id) 
        REFERENCES agents(id)
        ON DELETE CASCADE
);

CREATE INDEX idx_agent_skill_prices_agent_id ON agent_skill_prices(agent_id);

CREATE TABLE user_skill_purchases (
    user_id BIGINT NOT NULL,
    agent_id BIGINT NOT NULL,
    skill_name VARCHAR(255) NOT NULL,
    purchase_tx_signature VARCHAR(255) NOT NULL,
    amount_paid BIGINT NOT NULL,
    currency_mint VARCHAR(255) NOT NULL,
    purchased_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, agent_id, skill_name),
    CONSTRAINT fk_user
        FOREIGN KEY(user_id) 
        REFERENCES users(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_agent
        FOREIGN KEY(agent_id) 
        REFERENCES agents(id)
        ON DELETE CASCADE
);

CREATE INDEX idx_user_skill_purchases_user_id ON user_skill_purchases(user_id);
CREATE UNIQUE INDEX idx_user_skill_purchases_tx_signature ON user_skill_purchases(purchase_tx_signature);

```

## Definition of Done
-   A new SQL migration file with the `CREATE TABLE` statements for `agent_skill_prices` and `user_skill_purchases` is created.
-   The migration has been successfully applied to the development database.
-   The schema includes primary keys, foreign keys, and indexes as specified.
