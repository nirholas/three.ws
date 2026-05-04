---
status: not-started
last_updated: 2026-05-04
---
# Prompt 06: Database Schema for Purchased Skills

## Objective
Create the necessary database table to track which users have purchased which skills.

## Explanation
To manage access to paid skills, we need to record every successful purchase. A `user_purchased_skills` table will create a permanent record linking a user to a specific agent's skill they have acquired. This table is critical for the access control logic that will be built later.

## Instructions
1.  **Design the Table:**
    *   Create a new table named `user_purchased_skills`.
    *   The table should have the following columns:
        *   `id`: Primary key (UUID or SERIAL).
        *   `user_id`: Foreign key referencing the `users` table.
        *   `agent_id`: Foreign key referencing the `agent_identities` table.
        *   `skill_name`: A text field for the name of the skill.
        *   `purchase_tx_signature`: The on-chain transaction signature of the purchase, for auditing purposes.
        *   `price_amount`: The amount paid (in lamports or smallest unit).
        *   `price_currency_mint`: The currency used for the purchase.
        *   `created_at`: Timestamp of purchase.
    *   Add a unique constraint on (`user_id`, `agent_id`, `skill_name`) to prevent duplicate purchase records.

2.  **Write the SQL Migration:**
    *   Create a new SQL migration file.
    *   Write the `CREATE TABLE` statement based on the design.
    *   Add indexes on `user_id` and `agent_id` to speed up lookups for checking skill ownership.

## SQL Example

Here is the PostgreSQL `CREATE TABLE` statement.

```sql
CREATE TABLE IF NOT EXISTS user_purchased_skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    agent_id UUID NOT NULL,
    skill_name VARCHAR(255) NOT NULL,
    purchase_tx_signature VARCHAR(128) NOT NULL,
    price_amount BIGINT NOT NULL,
    price_currency_mint VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_user
        FOREIGN KEY(user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_agent
        FOREIGN KEY(agent_id)
        REFERENCES agent_identities(id)
        ON DELETE CASCADE,

    UNIQUE (user_id, agent_id, skill_name)
);

CREATE INDEX idx_user_purchased_skills_user_id ON user_purchased_skills(user_id);
CREATE INDEX idx_user_purchased_skills_agent_id ON user_purchased_skills(agent_id);
```
