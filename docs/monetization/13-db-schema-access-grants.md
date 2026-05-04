# Prompt 13: Database Schema for Skill Access Grants

## Objective
Design and create the database table schema for `skill_access_grants` to track which users have permission to use specific paid skills.

## Explanation
After a user pays for a skill, we need a persistent record of their access rights. This table will serve as the source of truth for the backend to check before executing a potentially paid skill. It needs to be flexible enough to support different access models, such as time-based expiry or a fixed number of uses.

## Instructions
1.  **Define the Table Schema:**
    *   Create a new table named `skill_access_grants`.
    *   The table should include the following columns:
        *   `id`: A unique primary key (e.g., UUID or auto-incrementing integer).
        *   `user_id`: Foreign key referencing the `users` table. This identifies who bought the skill.
        *   `agent_id`: Foreign key referencing the `agents` table.
        *   `skill_name`: A string that matches the name of the skill.
        *   `payment_id`: Foreign key referencing the `skill_payments` table, linking the grant to the specific purchase.
        *   `created_at`: Timestamp of when the grant was created.
        *   `expires_at`: A nullable timestamp. If set, the grant is valid until this time. This supports time-based access (e.g., 24-hour pass).
        *   `uses_left`: A nullable integer. If set, the grant is valid for this many uses. This supports pay-per-use models.

2.  **Create Indexes:**
    *   Create a composite index on `(user_id, agent_id, skill_name)` for fast lookups when checking for access before skill execution.
    *   Also, add an index on `expires_at` to efficiently query for expired grants if you need a cleanup job later.

3.  **Write the SQL Migration:**
    *   Create a new SQL migration file to apply this schema change to your database.

## SQL Schema Example

```sql
CREATE TABLE skill_access_grants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    skill_name VARCHAR(255) NOT NULL,
    payment_id UUID NOT NULL REFERENCES skill_payments(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    uses_left INTEGER,

    -- A user can have multiple grants for the same skill over time, so a unique constraint isn't on user/agent/skill
    CONSTRAINT check_positive_uses_left CHECK (uses_left IS NULL OR uses_left >= 0)
);

-- Index for fast access checks
CREATE INDEX idx_skill_access_grants_check ON skill_access_grants(user_id, agent_id, skill_name);

-- Index for cleaning up expired grants
CREATE INDEX idx_skill_access_grants_expires_at ON skill_access_grants(expires_at);

-- You'll also need a skill_payments table
CREATE TABLE skill_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    agent_id UUID NOT NULL,
    skill_name VARCHAR(255) NOT NULL,
    amount BIGINT NOT NULL,
    currency_mint VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, completed, failed
    signature VARCHAR(255) UNIQUE, -- The on-chain transaction signature
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```
