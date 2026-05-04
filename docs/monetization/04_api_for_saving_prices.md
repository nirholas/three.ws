---
status: not-started
last_updated: 2026-05-04
---
# Prompt 04: API for Saving Skill Prices

## Objective
Create a secure backend API endpoint for agent creators to save or update the prices for their skills.

## Explanation
The UI for setting skill prices needs a backend endpoint to persist the data. This endpoint must be secure, ensuring that only the owner of an agent can modify its skill prices. It will receive a payload of skill prices, validate it, and update the `agent_skill_prices` table.

## Instructions
1.  **Create the API File:**
    *   Create a new API file, for example, `api/agents/skill-prices.js` or add a new action to an existing agent-related dispatcher. The route could be `POST /api/agents/:id/skill-prices`.

2.  **Implement the Endpoint Logic:**
    *   **Authentication:** The endpoint must first authenticate the user and retrieve their ID.
    *   **Authorization:** It must verify that the authenticated user is the owner of the agent specified in the URL (`:id`).
    *   **Validation:** It should validate the incoming payload. The payload should be a JSON object where keys are skill names and values are objects containing `amount` and `currency_mint`. Use a library like `zod` for robust validation.
    *   **Database Operation:** For each skill price in the payload, perform an "upsert" operation on the `agent_skill_prices` table. If a price for that agent and skill already exists, update it. If not, insert a new row. This is a perfect use case for PostgreSQL's `ON CONFLICT` clause.

## Code Example (Vercel Serverless Function)

```javascript
// Example in: /api/agents/[agentId]/skill-prices.js
import { z } from 'zod';
import { sql } from '../../_lib/db.js';
import { getSessionUser } from '../../_lib/auth.js';
import { error, json, wrap } from '../../_lib/http.js';
import { parse } from '../../_lib/validate.js';

// Define the schema for a single price entry
const PriceSchema = z.object({
  amount: z.number().int().positive(),
  currency_mint: z.string().min(32).max(44), // Solana public key validation
});

// The incoming body should be a map of skill names to price objects
const BodySchema = z.record(z.string(), PriceSchema);

export default wrap(async (req, res) => {
    const user = await getSessionUser(req);
    if (!user) return error(res, 401, 'unauthorized');

    const agentId = req.query.agentId;
    const rawBody = await req.json();
    const pricesToUpdate = parse(BodySchema, rawBody);

    // 1. Verify ownership of the agent
    const [agent] = await sql`
        SELECT id FROM agent_identities
        WHERE id = ${agentId} AND user_id = ${user.id} AND deleted_at IS NULL
    `;
    if (!agent) return error(res, 404, 'not_found', 'Agent not found or you do not have permission.');

    // 2. Perform the upsert operation for all prices in a single transaction
    await sql.begin(async sql => {
        for (const [skillName, price] of Object.entries(pricesToUpdate)) {
            await sql`
                INSERT INTO agent_skill_prices (agent_id, skill_name, amount, currency_mint)
                VALUES (${agentId}, ${skillName}, ${price.amount}, ${price.currency_mint})
                ON CONFLICT (agent_id, skill_name)
                DO UPDATE SET
                    amount = EXCLUDED.amount,
                    currency_mint = EXCLUDED.currency_mint,
                    updated_at = NOW();
            `;
        }
    });

    return json(res, 200, { success: true, message: 'Skill prices updated.' });
});
```
