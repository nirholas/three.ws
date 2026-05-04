---
status: not-started
---

# Prompt 3: Create User Purchases Table

**Status:** Not Started

## Objective
Create a database table to track which users have purchased which skills.

## Explanation
To manage access to paid skills, we need to record every successful purchase. A `user_skill_purchases` table will store the relationship between a user, an agent, and a specific skill they've bought. This table will be the source of truth for skill ownership.

## Instructions
1.  **Create a new migration file:**
    - Create a migration file (e.g., `1683159000_create_user_skill_purchases.js`).

2.  **Define the table schema:**
    - The table should include:
        - `id`: Primary key.
        - `user_id`: Foreign key referencing the `users` table.
        - `agent_id`: Foreign key referencing the `agents` table.
        - `skill_name`: The name of the purchased skill.
        - `purchase_price`: The amount paid for the skill at the time of purchase.
        - `purchase_currency`: The currency mint used for the purchase.
        - `transaction_signature`: The signature of the on-chain transaction.
        - `purchased_at`: Timestamp of the purchase.

3.  **Add constraints:**
    - Create a unique constraint on `(user_id, agent_id, skill_name)`.
    - Add indexes on `user_id` and `agent_id` for performance.

## Code Example (SQL)

```sql
CREATE TABLE user_skill_purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    skill_name VARCHAR(255) NOT NULL,
    purchase_price BIGINT NOT NULL,
    purchase_currency VARCHAR(255) NOT NULL,
    transaction_signature VARCHAR(255) UNIQUE NOT NULL,
    purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, agent_id, skill_name)
);

CREATE INDEX idx_user_skill_purchases_user_id ON user_skill_purchases(user_id);
CREATE INDEX idx_user_skill_purchases_agent_id ON user_skill_purchases(agent_id);
```

## Verification
- Run the migration and check the database for the new `user_skill_purchases` table.
- Ensure all columns, constraints, and indexes are correctly defined.
