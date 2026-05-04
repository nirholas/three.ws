# Prompt 16: Skill Pricing Management - API

## Objective
Create the backend API endpoint to allow creators to save the prices they set for their skills.

## Explanation
This endpoint will receive the pricing information from the UI and persist it in the `agent_skill_prices` database table. It needs to be secure and handle updates efficiently.

## Instructions
1.  **Create the Database Table (if not exists):**
    *   You should have a table `agent_skill_prices`. If not, create it.
    *   Columns: `id`, `agent_id`, `skill_name`, `amount` (use a numeric type that can handle large integers, like `BIGINT`), `currency_mint`.
    *   Create a unique constraint on `(agent_id, skill_name)`.

2.  **Create the API Endpoint:**
    *   Create a new endpoint, e.g., `PUT /api/agents/:id/prices`.
    *   The `:id` parameter will be the agent's ID.
    *   Protect this endpoint with authentication middleware.

3.  **Implement Authorization and Validation:**
    *   Verify that the authenticated user (`req.user.id`) is the actual creator of the agent with the given `:id`. If not, return `403 Forbidden`.
    *   The request body will contain a `prices` object (a map of skill names to amounts).
    *   Validate this object: ensure it's a map, keys are strings, and values are non-negative integers.

4.  **Implement Database Logic (Upsert):**
    *   Iterate through the `prices` map from the request body.
    *   For each skill, perform an "upsert" operation in the `agent_skill_prices` table:
        *   If a row already exists for that `agent_id` and `skill_name`, `UPDATE` its `amount`.
        *   If it doesn't exist, `INSERT` a new row.
    *   If a skill's price is set to 0, you can either store it as 0 or `DELETE` the corresponding row, effectively making it a free skill. Deleting is often cleaner.

## SQL Upsert Example (PostgreSQL)

```sql
INSERT INTO agent_skill_prices (agent_id, skill_name, amount, currency_mint)
VALUES ($1, $2, $3, $4)
ON CONFLICT (agent_id, skill_name)
DO UPDATE SET amount = EXCLUDED.amount;
```

## API Logic Example (Node.js)

```javascript
// PUT /api/agents/:id/prices
export default async function handler(req, res) {
    // Assume auth middleware has run
    const agentId = parseInt(req.query.id);
    const creatorId = req.user.id;

    // 1. Authorization
    const agent = await db.getAgent(agentId);
    if (agent.creator_id !== creatorId) {
        return res.status(403).json({ message: "You are not the creator of this agent." });
    }

    const { prices } = req.body; // e.g., { "skill_one": 5000000 }

    // 2. Database updates in a transaction
    const dbClient = await db.getClient();
    try {
        await dbClient.query('BEGIN');
        for (const skillName in prices) {
            const amount = prices[skillName];
            if (amount > 0) {
                // Perform UPSERT
                await dbClient.query(upsertSql, [agentId, skillName, amount, 'USDC_MINT_ADDRESS']);
            } else {
                // Perform DELETE for skills set to 0
                await dbClient.query(deleteSql, [agentId, skillName]);
            }
        }
        await dbClient.query('COMMIT');
        res.status(200).json({ message: "Prices updated successfully." });
    } catch (e) {
        await dbClient.query('ROLLBACK');
        res.status(500).json({ message: "Failed to update prices." });
    } finally {
        dbClient.release();
    }
}
```
