---
title: "Prompt 4: Backend for Saving Skill Prices"
status: "completed"
---

# Prompt 4: Backend for Saving Skill Prices

**Status:** Completed

## Objective
Create the backend API endpoint to receive and persist the skill pricing data submitted from the creator UI.

## Explanation
With the creator UI in place, we now need a secure and efficient API endpoint to handle the data. This endpoint will receive a list of skill prices for a specific agent, validate that the request is coming from the agent's owner, and then atomically update the `agent_skill_prices` table.

## Instructions
1.  **Create a new API route:** Create a file at `api/agents/[agentId]/skills-pricing.js`. This will create a dynamic route that handles requests for specific agents.
2.  **Implement the handler:**
    *   The handler should only accept `PUT` requests.
    *   It must authenticate the request and ensure a user is logged in.
    *   It must validate that the logged-in user is the owner of the agent specified in the URL (`agentId`).
    *   It should expect a JSON body with a `prices` array, like `[{ "skill_id": "...", "amount": 1000000, "currency_mint": "..." }]`.
    *   Use a database transaction to first `DELETE` all existing prices for the agent and then `INSERT` the new ones. This ensures data consistency.
    *   Return a success message on completion or a descriptive error on failure.

## Code Example (`api/agents/[agentId]/skills-pricing.js`)

```javascript
import { getDb, getSession } from '../_lib/db.js';
import { json, error } from '../_lib/res.js';

export default async function handler(req, res) {
	if (req.method !== 'PUT') {
		return error(res, 405, 'Method Not Allowed');
	}

	const session = await getSession(req, res);
	if (!session.userId) {
		return error(res, 401, 'Unauthorized');
	}

	const { agentId } = req.query;
	if (!agentId || typeof agentId !== 'string') {
		return error(res, 400, 'Bad Request: Missing or invalid agentId');
	}

	const { prices } = req.body;
	if (!Array.isArray(prices)) {
		return error(res, 400, 'Bad Request: "prices" must be an array');
	}

	const db = await getDb();

	try {
		// First, verify that the user owns the agent.
		const agent = await db.oneOrNone('SELECT id FROM agent_identities WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL', [agentId, session.userId]);
		if (!agent) {
			return error(res, 403, 'Forbidden: You do not own this agent');
		}

		// Use a transaction to update prices atomically.
		await db.tx(async t => {
			// Clear existing prices for this agent.
			await t.none('DELETE FROM agent_skill_prices WHERE agent_id = $1', [agentId]);

			if (prices.length === 0) {
				return; // Nothing more to do if the array is empty.
			}

			// Use a multi-row insert for efficiency.
			const cs = new t.helpers.ColumnSet(['agent_id', 'skill_id', 'amount', 'currency_mint'], { table: 'agent_skill_prices' });
			const values = prices.map(p => ({
				agent_id: agentId,
				skill_id: p.skill_id,
				amount: p.amount,
				currency_mint: p.currency_mint,
			}));

			const query = t.helpers.insert(values, cs);
			await t.none(query);
		});

		return json(res, 200, { message: 'Prices updated successfully' });

	} catch (err) {
		console.error('Error saving skill prices:', err);
		return error(res, 500, 'Internal Server Error', err.message);
	}
}
```
