---
status: not-started
---

# Prompt 10: Backend - Save Skill Prices Endpoint

**Status:** Not Started

## Objective
Create a backend endpoint for saving or updating skill prices for an agent.

## Explanation
The creator-facing UI for setting prices needs a backend endpoint to persist the data. This endpoint will receive a list of skills and their prices and will perform an "upsert" operation (insert or update) into the `agent_skill_prices` table. This is a critical step in allowing creators to manage their skill offerings.

## Instructions
1.  **Create the API route:**
    - Create a new API route to handle this, e.g., `/api/agents/:id/skill-prices`.
    - It should accept `POST` or `PUT` requests.
    - This endpoint must be authenticated, and you must verify that the logged-in user is the owner of the agent they are trying to price skills for.

2.  **Handle the request:**
    - The request body should contain an object or array of skill prices, e.g., `[{ skill_name: 'text-to-speech', price: 1.50, currency: 'USDC' }, ...]`.
    - Loop through the submitted prices.
    - For each skill price, perform an `UPSERT` operation on the `agent_skill_prices` table.
        - If a price for that `agent_id` and `skill_name` already exists, `UPDATE` it.
        - If it doesn't exist, `INSERT` a new row.
    - Remember to convert the price from the human-readable format (e.g., 1.50 USDC) to the smallest unit (e.g., 1,500,000 lamports) before saving.

3.  **Handle price removal:**
    - If a creator sets a price to 0 or removes it, you can either delete the corresponding row from `agent_skill_prices` or mark it as inactive (e.g., with an `is_active` flag). Deleting is simpler for now.

## Code Example (SQL for `UPSERT`)

This example uses PostgreSQL syntax for an `UPSERT` operation.

```sql
-- For each skill price provided in the API request body...
INSERT INTO agent_skill_prices (agent_id, skill_name, amount, currency_mint)
VALUES ($1, $2, $3, $4)
ON CONFLICT (agent_id, skill_name)
DO UPDATE SET
    amount = EXCLUDED.amount,
    currency_mint = EXCLUDED.currency_mint,
    updated_at = NOW();
```

## Code Example (Node.js/Express-like handler)

```javascript
// api/agents/[id]/skill-prices.js

export default async function handler(req, res) {
  // ... authentication and ownership verification ...
  const agentId = req.query.id;
  const pricesToSet = req.body.prices; // e.g., [{ skill_name, price, currency }]

  // Use a transaction to update all prices atomically
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    for (const p of pricesToSet) {
      const amountInSmallestUnit = p.price * 1e6; // Convert to lamports
      if (amountInSmallestUnit > 0) {
        await client.query(
          `INSERT INTO agent_skill_prices (agent_id, skill_name, amount, currency_mint)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (agent_id, skill_name) DO UPDATE SET amount = $3, updated_at = NOW()`,
          [agentId, p.skill_name, amountInSmallestUnit, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyB7Gz3'] // USDC mint
        );
      } else {
        // If price is 0, delete the record
        await client.query(
          'DELETE FROM agent_skill_prices WHERE agent_id = $1 AND skill_name = $2',
          [agentId, p.skill_name]
        );
      }
    }
    
    await client.query('COMMIT');
    res.status(200).json({ success: true, message: 'Prices updated' });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to update prices' });
  } finally {
    client.release();
  }
}
```

## Verification
- On the "Monetization" tab of the agent edit page, set some prices for skills.
- Click "Save Prices."
- Check the network tab in your browser's developer tools to ensure the request is sent correctly.
- Verify that the data in your `agent_skill_prices` table is updated as expected.
- Reload the page and confirm that the prices you set are correctly displayed in the input fields.
- Try setting a price to 0 and verify that the corresponding row is deleted from the database.
