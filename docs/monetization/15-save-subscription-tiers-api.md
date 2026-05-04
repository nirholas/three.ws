---
status: not-started
---

# Prompt 15: Save and Manage Subscription Tiers API

## Objective
Implement the backend API endpoints for creating, updating, and deleting subscription tiers.

## Explanation
This prompt provides the backend support for the creator-facing UI built in the previous step. It involves creating a set of CRUD (Create, Read, Update, Delete) APIs to manage the `agent_subscription_tiers` table.

## Instructions
1.  **Create API Routes:**
    *   Set up the following authenticated routes, ensuring that only the agent owner can perform these actions.
    *   `POST /api/agents/:id/tiers`: Create a new subscription tier.
    *   `GET /api/agents/:id/tiers`: Get all tiers for a specific agent.
    *   `PUT /api/agents/:id/tiers/:tierId`: Update an existing tier.
    *   `DELETE /api/agents/:id/tiers/:tierId`: Delete a tier.

2.  **Implement Create Logic (`POST`):**
    *   The endpoint receives tier details in the request body.
    *   Validate the input (e.g., price must be a non-negative number).
    *   Insert a new record into the `agent_subscription_tiers` table.
    *   Return the newly created tier object.

3.  **Implement Read Logic (`GET`):**
    *   This endpoint can be public or owner-only, depending on whether you want users to see tiers before the UI is ready.
    *   Query the database for all tiers associated with the `agent_id`.
    *   Return the list of tiers.

4.  **Implement Update Logic (`PUT`):**
    *   Receive updated tier details in the request body.
    *   Validate the input.
    *   Update the corresponding record in the `agent_subscription_tiers` table where the `id` and `agent_id` match.
    *   Return the updated tier object.

5.  **Implement Delete Logic (`DELETE`):**
    *   This is a critical action. Before deleting, check if there are any active subscribers to this tier in the `user_subscriptions` table.
    *   Decide on a policy: either prevent deletion of tiers with active subscribers, or mark the tier as inactive (`active = false`) instead of a hard delete. Marking as inactive is generally safer.
    *   Perform the delete or update operation.
    *   Return a success status.

## Code Example (Backend - Express.js style routes)

```javascript
// Middleware to verify agent ownership for all tier routes
const verifyAgentOwner = async (req, res, next) => {
  const agentId = req.params.id;
  const userId = await getUserIdFromRequest(req);
  const agent = await db.query('SELECT owner_id FROM agents WHERE id = $1', [agentId]);
  if (!agent || agent.owner_id !== userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
};

const tierRoutes = express.Router({ mergeParams: true });
tierRoutes.use(verifyAgentOwner);

// GET /api/agents/:id/tiers
tierRoutes.get('/', async (req, res) => {
  const tiers = await db.query('SELECT * FROM agent_subscription_tiers WHERE agent_id = $1 ORDER BY price_amount', [req.params.id]);
  res.json(tiers.rows);
});

// POST /api/agents/:id/tiers
tierRoutes.post('/', async (req, res) => {
  const { name, description, price, currency, interval } = req.body;
  // Convert price to integer lamports, validate inputs...
  const amount = Math.round(price * 1e6);
  const result = await db.query(
    'INSERT INTO agent_subscription_tiers (agent_id, name, description, price_amount, price_currency_mint, interval) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
    [req.params.id, name, description, amount, currency, interval]
  );
  res.status(201).json(result.rows[0]);
});

// PUT /api/agents/:id/tiers/:tierId
tierRoutes.put('/:tierId', async (req, res) => {
  // ... similar logic to POST for updating ...
});

// DELETE /api/agents/:id/tiers/:tierId
tierRoutes.delete('/:tierId', async (req, res) => {
  const { tierId } = req.params;
  // SAFER: Mark as inactive instead of deleting
  await db.query('UPDATE agent_subscription_tiers SET active = false WHERE id = $1', [tierId]);
  res.status(204).send();
});

// Mount the routes in your main app file
// app.use('/api/agents/:id/tiers', tierRoutes);
```
