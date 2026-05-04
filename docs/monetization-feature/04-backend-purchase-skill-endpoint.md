---
status: not-started
---

# Prompt 4: Create Purchase Skill API Endpoint

**Status:** Not Started

## Objective
Create a backend API endpoint to handle the initiation of a skill purchase.

## Explanation
When a user decides to buy a skill, the frontend needs to communicate with the backend to start the transaction. This endpoint (`/api/skills/purchase`) will be responsible for validating the request, checking that the skill is for sale, and returning the necessary information for the frontend to proceed with the payment flow (e.g., a Solana Pay transaction request URL).

## Instructions
1.  **Create the API route:**
    - Create a new file for the purchase logic, e.g., `api/skills/purchase.js`.
    - This endpoint should handle `POST` requests.

2.  **Implement request handling:**
    - The request body should contain the `agent_id` and `skill_name` to be purchased.
    - The endpoint must be authenticated, so ensure you have the user's ID from their session.
    - **Validation:**
        - Check if the user has already purchased the skill by querying the `user_skill_purchases` table.
        - Fetch the skill's price from the `agent_skill_prices` table. If no price is found, return an error.

3.  **Generate transaction details:**
    - If the request is valid, generate the parameters needed for a Solana Pay transaction. This includes:
        - The recipient's public key (the agent creator's wallet).
        - The amount to be transferred.
        - The SPL token mint address (e.g., USDC).
        - A unique reference key for the transaction.

4.  **Return the response:**
    - The API should return a JSON object containing the Solana Pay URL or the transaction parameters that the frontend can use to initiate the payment.

## Code Example (Node.js/Express-like)

```javascript
// api/skills/purchase.js

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { agentId, skillName } = req.body;
  const userId = await getUserIdFromSession(req); // Assume you have this function

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // 1. Check if already purchased
  const existingPurchase = await db.query(
    'SELECT id FROM user_skill_purchases WHERE user_id = $1 AND agent_id = $2 AND skill_name = $3',
    [userId, agentId, skillName]
  );
  if (existingPurchase.rows.length > 0) {
    return res.status(409).json({ error: 'Skill already purchased' });
  }

  // 2. Get skill price
  const priceResult = await db.query(
    'SELECT amount, currency_mint FROM agent_skill_prices WHERE agent_id = $1 AND skill_name = $2',
    [agentId, skillName]
  );
  if (priceResult.rows.length === 0) {
    return res.status(404).json({ error: 'Skill not for sale' });
  }
  const price = priceResult.rows[0];

  // 3. (To be implemented in next step) Generate Solana Pay URL
  const { solanaPayUrl } = await generateSolanaPayUrl(price);

  // 4. Return response
  res.status(200).json({ solanaPayUrl });
}
```

## Verification
- Test the endpoint using a tool like Postman or `curl`.
- Verify that it correctly handles cases like unauthenticated requests, already purchased skills, and skills that are not for sale.
- Check that it returns the expected transaction details for a valid request.
