# Prompt 11: Backend API for Saving Skill Prices

## Status
- [ ] Not Started

## Objective
Create the backend API endpoint that allows agent creators to save the prices they've set for their skills.

## Explanation
This prompt complements the previous one by providing the backend infrastructure to persist the pricing information set in the agent editor UI. This endpoint will receive the pricing data and update the `agent_skill_prices` table.

## Instructions
1.  **Create the API Endpoint:**
    *   Create a new route, for example `POST /api/agents/:id/skill-prices`.
    *   This endpoint must be protected and only accessible by the agent's creator.

2.  **Implement the Update Logic:**
    *   The endpoint will receive the agent's ID and a payload containing the skill prices (e.g., `{ "skill_name": { "amount": ..., "currency_mint": "..." } }`).
    *   The logic should handle creating, updating, and deleting skill prices. A common approach is to:
        *   Delete all existing price entries for that agent.
        *   Insert the new price entries from the payload.
        *   This "delete-then-insert" pattern is simple to implement, but for more advanced use cases, you might want to perform individual `UPSERT` operations.
    *   Validate the input data to ensure amounts are valid numbers and currency mints are in the correct format.

## Code Example (Backend - `/api/agents/[id]/skill-prices.js`)
```javascript
// Example using a hypothetical DB utility
import { db } from './_db.js';
import { getUserIdFromRequest } from './_auth.js'; // Auth utility

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  
  const agentId = req.query.id;
  const userId = await getUserIdFromRequest(req);
  
  // 1. Authorization: Check if the user is the agent's creator
  const agent = await db.query('SELECT creator_id FROM agents WHERE id = $1', [agentId]);
  if (!agent || agent.creator_id !== userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const skillPrices = req.body.skillPrices;

  // 2. Database transaction for atomicity
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    
    // 3. Delete old prices for this agent
    await client.query('DELETE FROM agent_skill_prices WHERE agent_id = $1', [agentId]);

    // 4. Insert new prices
    for (const skillName in skillPrices) {
      const { amount, currency_mint } = skillPrices[skillName];
      // Basic validation
      if (typeof amount !== 'number' || typeof currency_mint !== 'string') {
        throw new Error('Invalid price data for skill: ' + skillName);
      }
      await client.query(
        'INSERT INTO agent_skill_prices (agent_id, skill_name, amount, currency_mint) VALUES ($1, $2, $3, $4)',
        [agentId, skillName, amount, currency_mint]
      );
    }
    
    await client.query('COMMIT');
    res.status(200).json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to save skill prices:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  } finally {
    client.release();
  }
}
```
