---
status: not-started
---

# Prompt 3: Backend API to Set Skill Prices

**Status:** Not Started

## Objective
Create a backend API endpoint that allows agent creators to set or update the price for a specific skill.

## Explanation
With the database table in place, we need a way for the frontend to communicate pricing information to the server. A secure API endpoint is required for this. The endpoint should ensure that only the owner of an agent can change the prices of its skills.

## Instructions
- [ ] **Create a new API file or modify an existing one.** A good place could be `api/agent-actions.js` or a new file like `api/agent-pricing.js`.
- [ ] **Define the endpoint.** Use `POST /api/agents/:id/skills/price`.
- [ ] **Implement authentication.** The endpoint must be protected. Verify that the authenticated user is the owner of the agent specified by `:id`.
- [ ] **Validate the request body.** The body should contain `skill_name`, `amount`, and `currency_mint`. Use a library like `zod` for validation.
- [ ] **Implement the database logic.** The endpoint should perform an "upsert" operation:
    - If a price for the agent's skill already exists, `UPDATE` it.
    - If it doesn't exist, `INSERT` a new row.
- [ ] **Return a success response.** On successful creation or update, return a `200 OK` or `201 Created` status with the updated pricing information.
- [ ] **Handle errors.** Return appropriate error codes (e.g., `401 Unauthorized`, `404 Not Found`, `400 Bad Request`, `500 Internal Server Error`).

## Code Example (Express.js-like)

```javascript
// In api/agent-actions.js or similar

// POST /api/agents/:id/skills/price
// Body: { "skill_name": "...", "amount": 1000000, "currency_mint": "..." }

export default async function handler(req, res) {
  // 1. Get authenticated user
  const user = await getAuthenticatedUser(req);
  const agentId = req.query.id;

  // 2. Verify ownership
  const agent = await db.query('SELECT * FROM agents WHERE id = $1', [agentId]);
  if (!agent || agent.owner_id !== user.id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // 3. Validate body
  const { skill_name, amount, currency_mint } = req.body;
  // ... validation logic ...

  // 4. Upsert price in DB
  const result = await db.query(
    `INSERT INTO agent_skill_prices (agent_id, skill_name, amount, currency_mint)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (agent_id, skill_name)
     DO UPDATE SET amount = $3, currency_mint = $4, updated_at = NOW()
     RETURNING *`,
    [agentId, skill_name, amount, currency_mint]
  );

  // 5. Return response
  res.status(200).json(result.rows[0]);
}
```

## Tracking Completion
- [ ] Mark this file's status as `Completed` in the frontmatter when done.
- [ ] Check off all instructions.
