# Prompt 03: Creator API to Set Skill Prices

## Objective
Create a secure API endpoint for agent creators to set, update, and remove prices for their skills.

## Explanation
With the database schema in place, creators need a way to manage their skill prices. This requires a new API endpoint that authenticates the user, verifies they own the agent, and allows them to perform CRUD operations on the `agent_skill_prices` table for that agent.

## Instructions
1.  **Create a New API Endpoint File:**
    *   Create a new file, for example, `api/agents/[id]/skill-prices.js`. Vercel's file-based routing will handle the `[id]` parameter.

2.  **Implement the Endpoint Logic:**
    *   The endpoint should handle `POST`, `PUT`, and `DELETE` requests.
    *   **Authentication:** Use the existing `getSessionUser` or `authenticateBearer` helpers to get the current user.
    *   **Authorization:** Verify that the authenticated user is the owner of the agent specified in the URL (`agent_id`). Query `agent_identities` to check ownership.
    *   **`POST` (Create):**
        *   Accept a payload with `skill_id`, `amount`, and `currency_mint`.
        *   Insert a new record into `agent_skill_prices`.
    *   **`PUT` (Update):**
        *   Accept `skill_id` and the new `amount`.
        *   Update the existing record in `agent_skill_prices`.
    *   **`DELETE` (Remove):**
        *   Accept `skill_id`.
        *   Soft-delete the record by setting `deleted_at`.
    *   **Validation:** Use `zod` to validate the incoming request bodies.

## Code Example (`api/agents/[id]/skill-prices.js`)

```javascript
import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { error, json, wrap } from '../_lib/http.js';
import { z } from 'zod';

const priceSchema = z.object({
  skill_id: z.string().min(1),
  amount: z.number().int().positive(),
  currency_mint: z.string().min(32), // Solana mint address length
});

export default wrap(async (req, res) => {
  const user = await getSessionUser(req);
  if (!user) return error(res, 401, 'unauthorized');

  const agentId = req.query.id;
  const [agent] = await sql`
    SELECT user_id FROM agent_identities WHERE id = ${agentId} AND deleted_at IS NULL
  `;

  if (!agent || agent.user_id !== user.id) {
    return error(res, 403, 'forbidden', 'You do not own this agent.');
  }

  if (req.method === 'POST') {
    const body = priceSchema.parse(await req.json());
    await sql`
      INSERT INTO agent_skill_prices (agent_id, skill_id, creator_id, amount, currency_mint)
      VALUES (${agentId}, ${body.skill_id}, ${user.id}, ${body.amount}, ${body.currency_mint})
    `;
    return json(res, { success: true });
  }

  // ... implement PUT and DELETE handlers similarly ...

  return error(res, 405, 'method_not_allowed');
});
```
