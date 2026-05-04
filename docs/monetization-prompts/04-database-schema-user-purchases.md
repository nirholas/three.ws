# Prompt 04: Database Schema for User Skill Purchases

## Objective
Create a database table to track which users have purchased which skills, effectively acting as a license or entitlement ledger.

## Explanation
When a user buys a skill, we need to record that transaction to grant them access. The `user_skill_purchases` table will store this information, linking a user, a skill, and the transaction details of their purchase. This table is critical for gating access to paid skills.

## Instructions
1.  **Locate the Schema File:**
    *   Open the main database schema definition file at `api/_lib/schema.sql`.

2.  **Define the `user_skill_purchases` Table:**
    *   Add a `CREATE TABLE` statement for `user_skill_purchases`.
    *   The table should include:
        *   `id`: UUID primary key.
        *   `user_id`: Foreign key to `users(id)`.
        *   `agent_id`: Foreign key to `agent_identities(id)`.
        *   `skill_id`: The identifier of the purchased skill.
        *   `price_id`: Foreign key to `agent_skill_prices(id)` to link to the exact price at time of purchase.
        *   `transaction_id`: A text field to store the on-chain transaction signature.
        *   `status`: An enum or text field for the purchase status (e.g., 'pending', 'confirmed', 'failed').
        *   `created_at`: Standard timestamp.

3.  **Add Indexes:**
    *   Create a unique index on `(user_id, agent_id, skill_id)` to prevent duplicate purchase records.
    *   Create an index on `transaction_id` for quick lookups.

## SQL Example

```sql
-- In api/_lib/schema.sql

CREATE TYPE purchase_status AS ENUM ('pending', 'confirmed', 'failed');

CREATE TABLE user_skill_purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    agent_id UUID NOT NULL REFERENCES agent_identities(id),
    skill_id TEXT NOT NULL,
    price_id UUID NOT NULL REFERENCES agent_skill_prices(id),
    transaction_id TEXT, -- e.g., Solana transaction signature
    status purchase_status NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_user_skill_purchases_one_per_user
ON user_skill_purchases (user_id, agent_id, skill_id);

CREATE INDEX idx_user_skill_purchases_tx_id ON user_skill_purchases(transaction_id);
```
