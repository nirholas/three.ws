---
status: not-started
---

# Prompt 3: Save Skill Prices

## Objective
Implement the backend API and frontend logic to save the skill prices set by a creator in the agent edit page.

## Explanation
Following the creation of the UI for skill pricing, this step involves creating the necessary API endpoint to receive and store the pricing data in the database. The frontend will be updated to send the data from the form to this endpoint.

## Instructions
1.  **Database Schema:**
    *   Ensure you have a table to store prices, e.g., `agent_skill_prices`.
    *   It should contain columns like `agent_id`, `skill_name`, `amount` (as an integer or bigint for precision), and `currency_mint`.

2.  **Create a Backend API Endpoint:**
    *   Create a new endpoint, for example, `POST /api/agents/:id/prices`. This could be in `api/agents/prices.js` or handled within the main agent update logic.
    *   This endpoint will receive an agent ID and a payload of skill prices (e.g., `{ "skill_name": { "amount": 1500000, "currency_mint": "..." } }`).
    *   The endpoint should be protected, ensuring only the agent's owner can update prices.
    *   The backend logic should perform an "upsert" operation: for each skill in the payload, it should `UPDATE` the price if it exists or `INSERT` a new row if it doesn't. Skills not in the payload or with an empty price can be deleted.

3.  **Update Frontend JavaScript:**
    *   In the script for `agent-edit.html`, add an event listener to the "Save Prices" button.
    *   When clicked, the script should gather all the data from the skill price input fields.
    *   It should construct a payload object mapping skill names to their price and currency. Remember to convert the human-readable amount (e.g., 1.50 USDC) back to the base unit (e.g., 1,500,000 lamports).
    *   Send this payload to the new API endpoint using a `fetch` POST request.
    *   Provide user feedback (e.g., a toast notification) on success or failure.

## Code Example (Backend API - Express.js style)

```javascript
// POST /api/agents/:id/prices
app.post('/api/agents/:id/prices', async (req, res) => {
  const { id } = req.params;
  const prices = req.body.prices; // Expects an object like { skillName: { amount, currency_mint } }
  const userId = await getUserIdFromRequest(req); // Your auth logic

  // 1. Verify user owns the agent
  const agent = await db.query('SELECT owner_id FROM agents WHERE id = $1', [id]);
  if (!agent || agent.owner_id !== userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // 2. Use a transaction to update prices
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    // First, clear existing prices for this agent
    await client.query('DELETE FROM agent_skill_prices WHERE agent_id = $1', [id]);
    // Then, insert the new ones
    for (const skillName in prices) {
      const { amount, currency_mint } = prices[skillName];
      if (amount > 0) {
        await client.query(
          'INSERT INTO agent_skill_prices (agent_id, skill_name, amount, currency_mint) VALUES ($1, $2, $3, $4)',
          [id, skillName, amount, currency_mint]
        );
      }
    }
    await client.query('COMMIT');
    res.status(200).json({ message: 'Prices updated successfully' });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Database error' });
  } finally {
    client.release();
  }
});
```

## Code Example (Frontend JavaScript)

```javascript
document.getElementById('save-prices-btn').addEventListener('click', async () => {
  const prices = {};
  const agentId = /* get agent ID from page */;

  document.querySelectorAll('.skill-price-row').forEach(row => {
    const priceInput = row.querySelector('.price-input');
    const currencySelect = row.querySelector('.currency-select');
    const skillName = priceInput.dataset.skill;
    const amountFloat = parseFloat(priceInput.value);

    if (skillName && !isNaN(amountFloat) && amountFloat > 0) {
      prices[skillName] = {
        amount: Math.round(amountFloat * 1e6), // Convert to lamports
        currency_mint: currencySelect.value
      };
    }
  });

  try {
    const response = await fetch(`/api/agents/${agentId}/prices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', /* Auth headers */ },
      body: JSON.stringify({ prices })
    });
    if (!response.ok) throw new Error('Failed to save prices');
    showToast('Prices saved!', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
});
```
