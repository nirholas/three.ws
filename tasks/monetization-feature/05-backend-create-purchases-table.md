---
status: not-started
---

# Prompt 5: Create Purchase-Tracking Table

**Status:** Not Started

## Objective
Create the `skill_purchases` table in the database to track which users have purchased access to which skills.

## Explanation
When a user buys a skill, we need to record that transaction to grant them permanent access. This table will serve as the source of truth for skill ownership. The agent's runtime will check this table to determine if a user is authorized to execute a premium skill.

## Instructions
- **Create a SQL Migration File:**
    - As before, create a new timestamped migration file, e.g., `YYYYMMDDHHMMSS_create_skill_purchases.sql`.

- **Define the Table Schema:**
    - The table needs to link a user, an agent, and a skill.
    - It should also store details about the purchase transaction for auditing and records.
    - A unique constraint on `user_id`, `agent_id`, and `skill_name` will prevent duplicate purchase records.

## SQL Example

```sql
-- migrations/YYYYMMDDHHMMSS_create_skill_purchases.sql

CREATE TABLE IF NOT EXISTS skill_purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    agent_id UUID NOT NULL,
    skill_name VARCHAR(255) NOT NULL,
    
    -- Purchase details
    purchase_amount BIGINT NOT NULL,
    purchase_currency_mint VARCHAR(255) NOT NULL,
    transaction_signature VARCHAR(255) NOT NULL, -- The on-chain tx signature
    
    purchased_at TIMESTAMPTZ DEFAULT NOW(),

    -- Foreign keys
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (agent_id) REFERENCES agent_identities(id) ON DELETE CASCADE,

    -- Each user can only buy a specific skill from a specific agent once
    UNIQUE (user_id, agent_id, skill_name)
);

-- Add indexes for faster lookups
CREATE INDEX idx_skill_purchases_user_skill ON skill_purchases(user_id, agent_id, skill_name);
CREATE INDEX idx_skill_purchases_transaction ON skill_purchases(transaction_signature);
```
## How to Run
- Use your migration tool or `psql` to apply this schema change to the database.
  ```bash
  psql -d YOUR_DATABASE_URL -f migrations/YYYYMMDDHHMMSS_create_skill_purchases.sql
  ```
