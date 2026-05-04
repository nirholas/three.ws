---
status: not-started
---
# Prompt 6: API to Fulfill Skill Purchase

**Status:** Not Started

## Objective
Create an endpoint to verify a signed transaction and officially record a skill purchase in the database.

## Explanation
After the user signs and broadcasts a transaction, the client will send the transaction signature to the backend. This endpoint will receive the signature, confirm the transaction on the Solana blockchain, and if it's valid and successful, record the purchase in the `skill_purchases` table.

## Instructions
- **Create a `POST` endpoint: `/api/skills/fulfill_purchase`.**
- **The request body should include `skill_id`, `agent_id`, and `signature`.**
- **Implement the following logic:**
    1.  **Authentication:** Ensure user is logged in.
    2.  **Transaction Verification:**
        - Use the `signature` to query the Solana blockchain.
        - Confirm the transaction has been finalized.
        - Parse the transaction details to ensure it matches the expected payments (correct amounts to creator and platform from the correct user). This prevents replay attacks or forged requests.
    3.  **Database Update:** If verification passes, insert a new record into the `skill_purchases` table.
    4.  **Response:** Return a success message.

## Code Example (Backend)
```javascript
// POST /api/skills/fulfill_purchase
import { Connection } from '@solana/web3.js';

async function fulfillPurchase(req, res) {
    const { skill_id, agent_id, signature } = req.body;
    const user_id = req.session.userId;

    // ... Auth, validation ...

    const connection = new Connection(process.env.SOLANA_RPC_URL);
    try {
        const tx = await connection.getParsedTransaction(signature, 'finalized');
        if (!tx) {
            return res.status(404).json({ error: 'Transaction not found or not finalized.' });
        }

        // ...
        // Add robust logic here to parse tx.transaction.message.instructions
        // and verify it matches the expected purchase details.
        // This is a critical security step.
        // ...

        const query = `
            INSERT INTO skill_purchases (agent_id, user_id, skill_id, price_id, purchase_amount, purchase_currency_mint, transaction_signature)
            VALUES ($1, $2, $3, ...);
        `;
        await db.none(query, [agent_id, user_id, skill_id, ...]);

        return res.status(200).json({ success: true, message: 'Purchase complete.' });

    } catch (error) {
        console.error('Fulfillment error:', error);
        return res.status(500).json({ error: 'Failed to fulfill purchase.' });
    }
}
```
