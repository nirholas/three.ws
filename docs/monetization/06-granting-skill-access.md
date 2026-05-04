# Prompt 6: Granting Skill Access (Backend)

## Objective
Upon successful purchase confirmation, create a database record that grants the user permanent access to the purchased skill.

## Explanation
This is the final step in the backend purchase flow. After the payment is verified, the system needs to record that the user now owns the skill. This is typically done by adding an entry to a linking table in the database, for example, `user_skill_ownership`. This record will be the source of truth for determining what premium content a user can access.

## Instructions
1.  **Database Schema:**
    *   If it doesn't exist, design and create a `user_skill_ownership` table.
    *   Essential columns would be `id`, `user_id`, `agent_id`, `skill_name`, and `created_at`.
    *   The combination of `user_id` and `skill_name` (and perhaps `agent_id` if skills are not globally unique) should be unique.

2.  **Create a Database Function (`_lib/db.js`):**
    *   Write a function, `grantSkillToUser(userId, agentId, skillName)`, that inserts a new record into the `user_skill_ownership` table.
    *   This function should handle potential errors, such as the user already owning the skill (which shouldn't happen if the purchase button is correctly disabled, but is good for data integrity).

3.  **Integrate into Confirmation Flow:**
    *   In the `GET` handler of your `api/payments/prepare-skill-purchase.js` endpoint, after the transaction has been successfully verified (as per the previous prompt), call your new `grantSkillToUser` function.
    *   Pass the authenticated user's ID and the skill details that you retrieved from your database using the transaction `reference`.

## Database Schema Example (SQL)

```sql
CREATE TABLE user_skill_ownership (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    agent_id UUID NOT NULL REFERENCES agents(id),
    skill_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, agent_id, skill_name)
);

-- Add an index for efficient lookups
CREATE INDEX idx_user_skill_ownership_user_id ON user_skill_ownership(user_id);
```

## Code Example (Backend - `_lib/db.js`)

```javascript
// This is a conceptual example using a generic DB client like 'pg' or 'slonik'
import { db } from './database-client';

export async function grantSkillToUser(userId, agentId, skillName) {
    try {
        const result = await db.query(
            `
            INSERT INTO user_skill_ownership (user_id, agent_id, skill_name)
            VALUES ($1, $2, $3)
            ON CONFLICT (user_id, agent_id, skill_name) DO NOTHING
            RETURNING id;
            `,
            [userId, agentId, skillName]
        );

        if (result.rows.length > 0) {
            console.log(`Granted skill '${skillName}' for agent '${agentId}' to user '${userId}'`);
            return true;
        } else {
            console.warn(`User '${userId}' already owns skill '${skillName}' for agent '${agentId}'`);
            return false; // Already owned
        }
    } catch (error) {
        console.error('Error in grantSkillToUser:', error);
        throw error;
    }
}
```
