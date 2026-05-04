# Prompt 14: Database for User's Purchased Skills

## Objective
Create a new table in the PostgreSQL database to permanently store which users have unlocked which skills for which agents.

## Explanation
Frontend state is temporary. To ensure a user's purchases are remembered across sessions and devices, we need to store their unlocked skills in our database. A dedicated table is the right way to do this. This table will link a `user_id` to an `agent_id` and a `skill_name`, creating a permanent record of the entitlement.

## Instructions
1.  **Create a New SQL Migration File:**
    *   In the `/api/_lib/migrations/` directory, create a new SQL file. A good name would be `2026-05-05-user-unlocked-skills.sql` (using a current or future date).

2.  **Write the DDL (Data Definition Language):**
    *   Inside the new file, write the `CREATE TABLE` statement for a table named `user_unlocked_skills`.
    *   The table should include the following columns:
        *   `user_id`: `UUID`, a foreign key referencing `users(id)`.
        *   `agent_id`: `UUID`, a foreign key referencing `agent_identities(id)`.
        *   `skill_name`: `TEXT`, to store the name of the skill.
        *   `created_at`: `TIMESTAMPTZ`, with a default value of `now()`.
        *   `source`: `TEXT`, to note how the skill was acquired (e.g., 'purchase').
        *   `payment_intent_id`: `TEXT`, a foreign key referencing `agent_payment_intents(id)`.
    *   Define a `PRIMARY KEY` on (`user_id`, `agent_id`, `skill_name`) to prevent duplicate entries.
    *   Add indexes on `user_id` and `agent_id` for efficient lookups.
    *   Wrap the entire statement in a `BEGIN;` and `COMMIT;` block to make it transactional.

3.  **Update the Payment Confirmation Logic:**
    *   In the backend API at `/api/payments/confirm.js`, modify the transaction block.
    *   After successfully creating the `agent_revenue_events` record, add a new `INSERT` statement to add a record to your new `user_unlocked_skills` table.
    *   You have all the necessary information available: `user.id`, `intent.agent_id`, `intent.payload.skill`, and the `intent_id`.

## Code Example (SQL Migration - `api/_lib/migrations/...-user-unlocked-skills.sql`)

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS user_unlocked_skills (
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id          UUID NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
    skill_name        TEXT NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    source            TEXT NOT NULL DEFAULT 'purchase',
    payment_intent_id TEXT REFERENCES agent_payment_intents(id) ON DELETE SET NULL,
    PRIMARY KEY (user_id, agent_id, skill_name)
);

CREATE INDEX IF NOT EXISTS user_unlocked_skills_user_id_idx ON user_unlocked_skills (user_id);
CREATE INDEX IF NOT EXISTS user_unlocked_skills_agent_id_idx ON user_unlocked_skills (agent_id);

COMMIT;
```

## Code Example (Backend - `/api/payments/confirm.js`)

```javascript
// ... inside the sql.transaction block ...

await tx`
    INSERT INTO agent_revenue_events
    -- ... (as before)
`;

await tx`
    INSERT INTO user_unlocked_skills
        (user_id, agent_id, skill_name, payment_intent_id)
    VALUES
        (${user.id}, ${intent.agent_id}, ${intent.payload.skill}, ${intent.id})
    ON CONFLICT (user_id, agent_id, skill_name) DO NOTHING
`;
```
After creating the migration file, remember to run your migration script to apply the changes to the database.
