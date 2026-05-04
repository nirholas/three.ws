---
status: completed
---
# Prompt 3: Backend API for Setting Skill Prices

**Status:** Completed

## Objective
Create a secure backend API endpoint for creators to save or update the prices for their agent's skills.

## Explanation
This endpoint will receive the pricing data from the creator UI (created in Prompt 2) and persist it to the `agent_skill_prices` database table. It's crucial to ensure that only the agent's owner can modify its skill prices.

## Instructions
- [x] **Create a New API Route:**
    - [x] In the `api/agents/` directory, create a new file or modify an existing one to handle a `POST` request, for example, `/api/agents/:id/skill-prices`.

- [x] **Implement Authorization:**
    - [x] The endpoint must be protected. Verify the user's session or API token.
    - [x] Check that the authenticated user is the owner of the agent specified by the `:id` parameter. If not, return a `403 Forbidden` error.

- [x] **Handle the Request:**
    - [x] The request body will contain an array of skill prices, like `{ prices: [{ skill_name: "...", amount: 500000, currency_mint: "..." }] }`.
    - [x] Validate the input data. Ensure `amount` is a non-negative number and `currency_mint` is a valid Solana mint address.

- [x] **Database Interaction:**
    - [x] For the given `agent_id`, update the `agent_skill_prices` table.
    - [x] A good approach is to use an "upsert" operation: if a price for a skill exists, update it; otherwise, insert a new row. You could also delete all existing prices for the agent and insert the new ones.
    - [x] The table should store `agent_id`, `skill_name`, `amount`, and `currency_mint`.

- [x] **Return a Response:**
    - [x] On success, return a `200 OK` or `204 No Content` response.
    - [x] On failure (validation error, database error), return an appropriate error code (e.g., `400 Bad Request`, `500 Internal Server Error`) with a descriptive message.

## Code Example (Vercel Serverless Function)

Here's a conceptual example of the API endpoint logic.

```javascript
// in /api/agents/[id]/skill-prices.js
import { getAuth } from './_lib/auth';
import { db } from './_lib/db';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { id: agentId } = req.query;
  const { prices } = req.body;

  // 1. Authorization
  const user = await getAuth(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const agent = await db.query('SELECT owner_id FROM agents WHERE id = $1', [agentId]);
  if (!agent.rows.length || agent.rows[0].owner_id !== user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // 2. Validation (basic example)
  if (!Array.isArray(prices)) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  // 3. Database Interaction (transaction recommended)
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Delete old prices
    await client.query('DELETE FROM agent_skill_prices WHERE agent_id = $1', [agentId]);
    // Insert new prices
    for (const price of prices) {
      await client.query(
        'INSERT INTO agent_skill_prices (agent_id, skill_name, amount, currency_mint) VALUES ($1, $2, $3, $4)',
        [agentId, price.skill_name, price.amount, price.currency_mint]
      );
    }
    await client.query('COMMIT');
    res.status(204).end();
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'Failed to save prices' });
  } finally {
    client.release();
  }
}
```
