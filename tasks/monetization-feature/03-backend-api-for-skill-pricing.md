---
status: not-started
---

# Prompt 3: Create API for Skill Pricing

**Status:** Not Started

## Objective
Create backend API endpoints for creators to set, update, and remove prices for their agent's skills.

## Explanation
With the database table in place, creators need a way to manage the prices of their skills. We will create a secure API endpoint that allows an agent's owner to define these prices. This endpoint will handle creating new price entries, updating existing ones, and deleting them.

## Instructions
- **Create a New API Route:**
    - Create a new API file, for example, `/api/agents/[id]/skill-prices.js`.
    - This route will handle `POST`, `PUT`, and `DELETE` requests for a specific agent's skill prices.
    - Ensure the route is protected and can only be accessed by the authenticated owner of the agent.

- **Implement the `POST` Handler (Create/Update):**
    - The `POST` handler will receive a skill name, an amount, and a currency mint in the request body.
    - It should use an `INSERT ... ON CONFLICT` (UPSERT) query to either create a new price entry or update an existing one for the given agent and skill. This is more efficient than checking for existence first.
    - Validate the input data. The amount should be a non-negative integer.

- **Implement the `DELETE` Handler (Remove):**
    - The `DELETE` handler will receive a skill name in the request body or query parameters.
    - It will execute a `DELETE` query to remove the price entry from the `agent_skill_prices` table for that agent and skill.

## Code Example (Backend - `/api/agents/[id]/skill-prices.js`)

```javascript
// Example using Node.js, Express-like syntax, and `sql` from './_lib/db.js'

import { getSessionUser } from './_lib/auth.js';
import { sql } from './_lib/db.js';
import { error, json, method, readJson, wrap } from './_lib/http.js';

export default wrap(async (req, res, id) => {
    if (!method(req, res, ['POST', 'DELETE'])) return;

    const user = await getSessionUser(req);
    if (!user) return error(res, 401, 'unauthorized', 'sign in required');

    const [agent] = await sql`
        SELECT id, user_id FROM agent_identities WHERE id = ${id} AND deleted_at IS NULL
    `;
    if (!agent) return error(res, 404, 'not_found', 'agent not found');
    if (agent.user_id !== user.id) return error(res, 403, 'forbidden', 'not your agent');

    const body = await readJson(req);
    const { skill_name } = body;
    if (!skill_name) return error(res, 400, 'validation_error', 'skill_name is required');

    if (req.method === 'POST') {
        const { amount, currency_mint } = body;
        if (amount == null || !currency_mint) {
            return error(res, 400, 'validation_error', 'amount and currency_mint are required');
        }

        const [price] = await sql`
            INSERT INTO agent_skill_prices (agent_id, skill_name, amount, currency_mint)
            VALUES (${id}, ${skill_name}, ${BigInt(amount)}, ${currency_mint})
            ON CONFLICT (agent_id, skill_name)
            DO UPDATE SET amount = EXCLUDED.amount, currency_mint = EXCLUDED.currency_mint, updated_at = NOW()
            RETURNING *
        `;
        return json(res, 200, { price });
    }

    if (req.method === 'DELETE') {
        await sql`
            DELETE FROM agent_skill_prices WHERE agent_id = ${id} AND skill_name = ${skill_name}
        `;
        return json(res, 200, { ok: true });
    }
});
```
