---
status: completed
---

# Prompt 3: Backend - Create API for Setting Skill Prices

## Objective
Create a secure API endpoint for agent creators to set or update the prices for their skills.

## Explanation
Now that the `agent_skill_prices` table exists, we need an API endpoint to allow creators to manage the prices of their skills. This endpoint will receive the skill ID, price, and currency, validate the request, and then insert or update the price in the database. It's crucial that only the creator of a skill can set its price.

## Instructions
1.  **Create the API Route:**
    *   Create a new API route, for example, `POST /api/agents/:agentId/skills/:skillId/price`.
    *   This route should be protected and require user authentication.

2.  **Implement the Endpoint Logic:**
    *   In the request handler, first, verify that the authenticated user is the owner of the agent and the skill. This is a critical security check.
    *   Validate the incoming request body. It should contain `amount` (as a number) and `currency_mint` (as a string).
    *   Implement the database logic to `INSERT` a new price record into `agent_skill_prices`. If a price for that skill by that creator already exists, `UPDATE` the existing record (an "upsert" operation).
    *   Return a success response if the operation is successful, or an error response if the user is not authorized or the input is invalid.

## Code Example (Backend API - e.g., using Express.js)

```javascript
// POST /api/agents/:agentId/skills/:skillId/price
// (Middleware for authentication and agent ownership should be applied before this handler)

async function setSkillPrice(req, res) {
  const { userId } = req.auth; // From auth middleware
  const { agentId, skillId } = req.params;
  const { amount, currency_mint } = req.body;

  // 1. Validate input
  if (typeof amount !== 'number' || !currency_mint || typeof currency_mint !== 'string') {
    return res.status(400).json({ error: 'Invalid input' });
  }

  // 2. Verify ownership (this logic depends on your schema)
  const isOwner = await verifySkillOwnership(userId, agentId, skillId);
  if (!isOwner) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // 3. Upsert the price in the database
  try {
    const { rows } = await db.query(
      `INSERT INTO agent_skill_prices (skill_id, creator_id, amount, currency_mint)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (skill_id, creator_id)
       DO UPDATE SET amount = EXCLUDED.amount, currency_mint = EXCLUDED.currency_mint, updated_at = NOW()
       RETURNING *`,
      [skillId, userId, amount, currency_mint]
    );
    res.status(200).json({ price: rows[0] });
  } catch (error) {
    console.error('Error setting skill price:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
```
