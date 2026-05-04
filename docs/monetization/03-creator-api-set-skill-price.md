---
status: not-started
completed_at: null
---
# Prompt 3: Creator API to Set/Update Skill Prices

## Objective
Create a secure backend API endpoint that allows agent creators to set, update, or remove the price for their agent's skills.

## Explanation
To enable a creator-driven economy, we need to provide the tools for creators to manage their offerings. This prompt focuses on building the backend endpoint that will power the UI for pricing skills in the Creator Dashboard. The endpoint must be secure, ensuring only the agent's owner can modify prices.

## Instructions
1.  **Define the API Endpoint:**
    *   Create a new API route: `POST /api/creator/agents/:agentId/skills/price`.
    *   This endpoint will handle creating, updating, and deleting skill prices.

2.  **Implement Authentication and Authorization:**
    *   The endpoint must be protected. Ensure you have middleware that verifies the user is authenticated (e.g., checks for a valid session cookie or JWT).
    *   Implement an authorization check. Before processing the request, verify that the authenticated user is the owner of the `agentId` specified in the URL. If not, return a `403 Forbidden` error.

3.  **Handle the Request Body:**
    *   The request body should contain:
        *   `skill_name`: The name of the skill to price.
        *   `amount` (optional): The price in the smallest currency unit. If `null` or `0`, it implies the skill is being made free (price is being removed).
        *   `currency_mint` (optional): The SPL token mint address. Required if `amount` is greater than 0.

4.  **Implement Database Logic:**
    *   **If `amount` is positive:**
        *   Use an `UPSERT` (or `INSERT ... ON CONFLICT UPDATE`) operation on the `agent_skill_prices` table.
        *   Match on the composite primary key `(agent_id, skill_name)`.
        *   If a record exists, `UPDATE` the `amount` and `currency_mint`.
        *   If no record exists, `INSERT` a new row.
    *   **If `amount` is `null`, `0`, or not provided:**
        *   `DELETE` the corresponding row from the `agent_skill_prices` table for that `agent_id` and `skill_name`.

5.  **Return a Response:**
    *   On success, return a `200 OK` or `204 No Content` response.
    *   On validation failure (e.g., missing `currency_mint` for a paid skill), return a `400 Bad Request`.

## Code Example (Backend API Handler)

```javascript
// Example using Express.js and a hypothetical 'db' client

// Assume 'authMiddleware' and 'agentOwnershipMiddleware' exist and are applied to this route.
app.post('/api/creator/agents/:agentId/skills/price', async (req, res) => {
  const { agentId } = req.params;
  const { skill_name, amount, currency_mint } = req.body;

  // Basic validation
  if (!skill_name) {
    return res.status(400).json({ error: 'skill_name is required.' });
  }

  const numericAmount = amount ? BigInt(amount) : 0n;

  if (numericAmount > 0n && !currency_mint) {
    return res.status(400).json({ error: 'currency_mint is required for paid skills.' });
  }

  try {
    if (numericAmount > 0n) {
      // Upsert logic
      const query = `
        INSERT INTO agent_skill_prices (agent_id, skill_name, amount, currency_mint)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (agent_id, skill_name)
        DO UPDATE SET amount = $3, currency_mint = $4, updated_at = CURRENT_TIMESTAMP;
      `;
      await db.query(query, [agentId, skill_name, numericAmount, currency_mint]);
    } else {
      // Delete logic (make skill free)
      const query = `
        DELETE FROM agent_skill_prices
        WHERE agent_id = $1 AND skill_name = $2;
      `;
      await db.query(query, [agentId, skill_name]);
    }

    res.status(204).send();

  } catch (error) {
    console.error('Failed to update skill price:', error);
    res.status(500).json({ error: 'An internal error occurred.' });
  }
});
```

## Definition of Done
-   A new `POST` endpoint at `/api/creator/agents/:agentId/skills/price` is created and functional.
-   The endpoint correctly requires authentication.
-   The endpoint correctly verifies that the user owns the agent before making changes.
-   The endpoint can successfully create, update, and delete entries in the `agent_skill_prices` table based on the request body.
-   Appropriate error responses (`400`, `403`, `500`) are returned in failure cases.
