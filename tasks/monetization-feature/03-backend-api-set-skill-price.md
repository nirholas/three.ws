---
status: not-started
---

# Prompt 3: Backend API - Set/Update Skill Price

**Status:** Not Started

## Objective
Create a secure API endpoint that allows an agent's creator to set or update the price of a skill.

## Explanation
Now that the database table exists, creators need a way to manage their skill prices. This endpoint will accept a price, skill name, and agent ID. It must be secure, ensuring that only the authenticated user who owns the agent can modify its skill prices.

## Instructions
- [ ] **Create a new API file:** `api/marketplace/set-skill-price.js`.
- [ ] **Implement the endpoint logic:**
    - [ ] It should handle `POST` requests.
    - [ ] It must authenticate the user (e.g., via a session or API key).
    - [ ] It needs to verify that the authenticated user is the owner of the agent they are trying to price a skill for.
    - [ ] It will take `agent_id`, `skill_name`, `amount`, and `currency_mint` as input from the request body.
    - [ ] Use an `INSERT ... ON CONFLICT` (or "upsert") query to create or update the price in the `agent_skill_prices` table.

## Code Example (`api/marketplace/set-skill-price.js`)

```javascript
import { sql } from '../_lib/db.js';
import { json, method, cors, error, auth } from '../_lib/http.js';

export default async function setSkillPrice(req, res) {
    if (cors(req, res)) return;
    if (!method(req, res, ['POST'])) return;
    const authUser = await auth(req, res);
    if (!authUser) return;

    const { agent_id, skill_name, amount, currency_mint } = req.body;

    if (!agent_id || !skill_name || !amount || !currency_mint) {
        return error(res, 400, 'bad_request', 'Missing required fields.');
    }

    try {
        // First, verify ownership of the agent
        const [agent] = await sql`
            SELECT id FROM agents WHERE id = ${agent_id} AND user_id = ${authUser.id}
        `;

        if (!agent) {
            return error(res, 403, 'forbidden', 'You do not own this agent.');
        }

        // Now, upsert the price
        await sql`
            INSERT INTO agent_skill_prices (agent_id, skill_name, amount, currency_mint, updated_at)
            VALUES (${agent_id}, ${skill_name}, ${amount}, ${currency_mint}, NOW())
            ON CONFLICT (agent_id, skill_name)
            DO UPDATE SET
                amount = EXCLUDED.amount,
                currency_mint = EXCLUDED.currency_mint,
                updated_at = NOW();
        `;

        return json(res, 200, { ok: true, message: 'Price set successfully.' });

    } catch (e) {
        console.error('Error setting skill price:', e);
        return error(res, 500, 'server_error', 'Failed to set skill price.');
    }
}
```

## Tracking
- To mark this task as complete, check all boxes in the instructions and change the status in the frontmatter to `Completed`.
