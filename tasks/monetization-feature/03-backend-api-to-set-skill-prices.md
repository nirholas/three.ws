---
status: completed
---

# Prompt 3: Backend - API to Set Skill Prices

**Status:** Not Started

## Objective
Create an API endpoint that allows an agent creator to set or update the price of their skills.

## Explanation
With the `agent_skill_prices` table in place, we now need a way for creators to interact with it. This task involves creating a secure API endpoint that accepts pricing information for a skill and saves it to the database.

## Instructions
1.  **Create the API Endpoint:**
    -   Create a new API route file, for example, `/api/agents/[id]/skills.js`.
    -   Implement a `POST` or `PUT` handler for this route.
    -   The route should be protected, ensuring only the authenticated owner of the agent can set prices.

2.  **Implement the Handler Logic:**
    -   The handler should accept a request body containing `skill_name`, `amount`, and `currency_mint`.
    -   Validate the input: ensure `amount` is a positive number and `currency_mint` is a valid address.
    -   Use an "upsert" operation:
        -   If a price for that `agent_id` and `skill_name` already exists, `UPDATE` it.
        -   If it doesn't exist, `INSERT` a new row.
    -   Return a success response with the updated pricing information.

## Code Example (Vercel Serverless Function - `api/agents/[id]/skills.js`)

```javascript
// Example using a hypothetical database client
import { db } from '@lib/db';
import { withAuth } from '@lib/auth';

async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { id: agentId } = req.query;
    const { userId } = req.auth;
    const { skill_name, amount, currency_mint } = req.body;

    // 1. Verify ownership
    const agent = await db.query('SELECT owner_id FROM agents WHERE id = $1', [agentId]);
    if (!agent.rows.length || agent.rows[0].owner_id !== userId) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    // 2. Validate input
    if (!skill_name || typeof amount !== 'number' || amount < 0 || !currency_mint) {
        return res.status(400).json({ error: 'Invalid input' });
    }

    try {
        // 3. Upsert into database
        const result = await db.query(
            `INSERT INTO agent_skill_prices (agent_id, skill_name, amount, currency_mint)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (agent_id, skill_name)
             DO UPDATE SET amount = EXCLUDED.amount, currency_mint = EXCLUDED.currency_mint, updated_at = NOW()
             RETURNING *`,
            [agentId, skill_name, amount, currency_mint]
        );

        return res.status(200).json(result.rows[0]);
    } catch (error) {
        console.error('Error setting skill price:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}

export default withAuth(handler);
```

## Definition of Done
-   The API endpoint is created and functional.
-   The endpoint is protected and only allows the agent owner to set prices.
-   The database is correctly updated with the new pricing information.
-   Automated tests are added for this endpoint.
