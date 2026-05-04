# Prompt 15: Backend Logic to Check for Active Grant

## Objective
Flesh out the database query and logic for checking if a user has a valid, active grant for a specific skill before execution.

## Explanation
This prompt focuses on completing the check designed in Prompt 8. With the `skill_access_grants` table now defined, we can write the precise database query that powers the access check. This logic is the gatekeeper for all paid skills.

## Instructions
1.  **File to Edit:**
    *   Open your backend chat orchestrator (e.g., `/api/chat.js`) where the initial paid skill detection happens.

2.  **Create a Database Query Function:**
    *   In your database access layer, create a function like `checkForValidSkillGrant({ userId, agentId, skillName })`.

3.  **Implement the Query Logic:**
    *   This function needs to query the `skill_access_grants` table.
    *   The `WHERE` clause is the most important part. It should find a row where:
        *   `user_id`, `agent_id`, and `skill_name` all match the function's arguments.
        *   **AND** the grant is not expired. This requires a sub-clause: `(expires_at IS NULL OR expires_at > NOW())`.
        *   **AND** the grant has uses remaining: `(uses_left IS NULL OR uses_left > 0)`.
    *   You only need to know if *any* such grant exists, so you can optimize the query to return just one row or a simple count (`SELECT 1` or `SELECT COUNT(*)`). The function should return `true` if a valid grant is found, and `false` otherwise.

4.  **Decrement `uses_left` (for pay-per-use skills):**
    *   If a grant is found that relies on `uses_left` (i.e., `expires_at` is `NULL`), you must decrement the `uses_left` count in the database as part of this check.
    *   This should be an atomic `UPDATE` operation: `UPDATE skill_access_grants SET uses_left = uses_left - 1 WHERE id = ...`.
    *   This decrement should happen within a transaction to avoid race conditions.

## Code Example (Backend - Database Access Layer)

```javascript
// Example using a SQL query builder like Knex.js

async function checkForValidSkillGrant({ userId, agentId, skillName }) {
  // Find a grant that is either time-based and not expired, or use-based and has uses left.
  const grants = await db('skill_access_grants')
    .where({
      user_id: userId,
      agent_id: agentId,
      skill_name: skillName,
    })
    .where(builder => {
      builder.where(q => {
        q.whereNotNull('expires_at').andWhere('expires_at', '>', db.fn.now());
      }).orWhere(q => {
        q.whereNotNull('uses_left').andWhere('uses_left', '>', 0);
      })
    })
    .select('id', 'uses_left')
    .limit(1);

  if (grants.length === 0) {
    return false; // No valid grant found
  }

  const grant = grants[0];

  // If this was a use-based grant, decrement the count.
  if (grant.uses_left !== null && grant.uses_left > 0) {
    await db('skill_access_grants')
      .where({ id: grant.id })
      .decrement('uses_left', 1);
  }

  return true; // Grant is valid
}
```
This function would then be called from your chat handler as shown in Prompt 8.
