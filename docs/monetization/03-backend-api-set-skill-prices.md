---
status: not-started
---

# Prompt 3: Backend - API to Set/Update Skill Prices

## Objective
Create a secure backend API endpoint that allows an agent's creator to set or update the price of their skills.

## Explanation
With the database table in place, we now need a way for creators to manage their skill prices programmatically. This requires an authenticated API endpoint that accepts pricing information and updates the `agent_skill_prices` table. The endpoint must verify that the user making the request is the owner of the agent.

## Instructions
1.  **Create the API Endpoint File:**
    *   Create a new file in the API directory, for example, `api/agents/skills.js`. This can be a Vercel serverless function.
    *   This endpoint should handle `POST` or `PUT` requests to a path like `/api/agents/[agentId]/skills/prices`.

2.  **Implement Authentication and Authorization:**
    *   The endpoint must be authenticated. Use your existing authentication middleware (e.g., checking for a valid JWT or session cookie) to get the `user_id` of the requester.
    *   Before making any database changes, verify that the `user_id` owns the `agentId` specified in the URL. You'll need to query the `agent_identities` table. If they are not the owner, return a `403 Forbidden` error.

3.  **Handle the Request Body:**
    *   The request body should contain the skill's name, the price amount (in lamports), and the currency mint address.
    *   Example body: `{ "skill_name": "Jupiter Swapper", "amount": 1000000, "currency_mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyB7u6T" }`
    *   Validate the input. Ensure `amount` is a non-negative number and `currency_mint` is a valid Solana public key format.

4.  **Implement the Database Logic:**
    *   Use an `INSERT ... ON CONFLICT` (UPSERT) statement to either create a new price entry or update an existing one for the given `agent_id` and `skill_name`.
    *   The `ON CONFLICT (agent_id, skill_name) DO UPDATE` clause makes the logic simple and atomic.

5.  **Return a Response:**
    *   If successful, return a `200 OK` or `201 Created` status with the newly created/updated pricing information.
    *   Return appropriate error codes for bad input (`400`), unauthorized access (`403`), or server errors (`500`).

## Code Example (Vercel Serverless Function - `api/agents/skills.js`)

```javascript
import { cors, json, method, wrap } from '../_lib/http.js';
import { getAuth } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';

export default wrap(async (req, res) => {
    if (cors(req, res)) return;
    if (!method(req, res, ['POST'])) return;

    // 1. Authentication
    const auth = await getAuth(req);
    if (!auth.userId) {
        return json(res, 401, { error: 'Authentication required' });
    }

    // 2. Extract agentId and validation
    const { agentId } = req.query;
    if (!agentId) {
        return json(res, 400, { error: 'Agent ID is required' });
    }

    const [agent] = await sql`
        SELECT user_id FROM agent_identities WHERE id = ${agentId}
    `;

    if (!agent) {
        return json(res, 404, { error: 'Agent not found' });
    }

    // 3. Authorization
    if (agent.user_id !== auth.userId) {
        return json(res, 403, { error: 'You do not own this agent' });
    }

    // 4. Input validation
    const { skill_name, amount, currency_mint } = req.body;
    if (!skill_name || typeof amount !== 'number' || amount < 0 || !currency_mint) {
        return json(res, 400, { error: 'Invalid input: skill_name, amount, and currency_mint are required.' });
    }

    // 5. Database UPSERT
    try {
        const [price] = await sql`
            INSERT INTO agent_skill_prices
                (agent_id, skill_name, amount, currency_mint)
            VALUES
                (${agentId}, ${skill_name}, ${amount}, ${currency_mint})
            ON CONFLICT (agent_id, skill_name)
            DO UPDATE SET
                amount = EXCLUDED.amount,
                currency_mint = EXCLUDED.currency_mint,
                updated_at = NOW()
            RETURNING *
        `;
        return json(res, 200, { price });
    } catch (error) {
        console.error('Failed to set skill price:', error);
        return json(res, 500, { error: 'Internal Server Error' });
    }
});
```
