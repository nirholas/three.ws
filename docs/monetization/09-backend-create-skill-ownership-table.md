---
status: not-started
---

# Prompt 9: Backend - Create Skill Ownership Table

## Objective
Create a database table to permanently record which users have successfully purchased which skills.

## Explanation
After a user pays for a skill, we need to record their ownership so they don't have to pay for it again. A dedicated table, `user_unlocked_skills`, will store the relationship between a user, an agent, and a specific skill. This table will be the source of truth for checking skill access.

## Instructions
1.  **Design the Table Schema:**
    *   Name the table `user_unlocked_skills`.
    *   It needs a column to link to the user (`user_id`).
    *   It needs a column to link to the agent (`agent_id`).
    *   It needs a column to identify the skill (`skill_name`).
    *   It's highly recommended to store a reference to the purchase transaction (`purchase_tx_signature`) for auditing and customer support purposes.
    *   Add a primary key and foreign keys to `users` and `agent_identities`.
    *   Create a unique constraint on (`user_id`, `agent_id`, `skill_name`) to ensure a user can't have duplicate entries for the same skill.

2.  **Create a SQL Migration File:**
    *   Create a new SQL migration file (e.g., `scripts/migrations/003_create_user_unlocked_skills.sql`).
    *   Write the `CREATE TABLE` statement.
    *   Include a `created_at` timestamp to know when the skill was unlocked.

## Code Example (SQL)

```sql
-- scripts/migrations/003_create_user_unlocked_skills.sql

CREATE TABLE IF NOT EXISTS user_unlocked_skills (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id INTEGER NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
    skill_name VARCHAR(255) NOT NULL,
    
    -- The Solana transaction signature of the purchase
    purchase_tx_signature VARCHAR(88) NOT NULL,
    
    -- Store price info at time of purchase for historical records
    purchase_amount BIGINT NOT NULL,
    purchase_currency_mint VARCHAR(44) NOT NULL,

    unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- A user can only unlock a specific agent's skill once.
    UNIQUE (user_id, agent_id, skill_name)
);

-- Add indexes for common queries
CREATE INDEX IF NOT EXISTS idx_user_unlocked_skills_user_id ON user_unlocked_skills(user_id);
CREATE INDEX IF NOT EXISTS idx_user_unlocked_skills_agent_id ON user_unlocked_skills(agent_id);
```
