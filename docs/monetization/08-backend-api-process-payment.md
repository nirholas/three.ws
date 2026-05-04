---
status: not-started
---

# Prompt 8: Backend API to Process Payments

## Objective
Create a backend endpoint to verify and record a skill purchase transaction after it has been confirmed on the blockchain.

## Explanation
After a user's transaction is successfully sent to the Solana network, the frontend needs to notify the backend. The backend will then verify the transaction and, if it's valid, record that the user now owns the skill. This prevents users from accessing paid skills without a valid payment.

## Instructions
1.  **Create a New API Endpoint:**
    *   Create a new endpoint, for example, `POST /api/marketplace/skills/purchase`.
    *   This endpoint will receive the transaction signature and the skill name being purchased.

2.  **Verify the Transaction:**
    *   In the backend, use the Solana web3 library to fetch the transaction details using the signature.
    *   Verify that the transaction is valid:
        *   It transferred the correct amount of the correct currency.
        *   The funds were sent from the user's wallet to the correct creator's wallet.
        *   The transaction has been successfully confirmed.

3.  **Record the Purchase:**
    *   If the transaction is valid, insert a new record into the `user_skill_purchases` table to grant the user ownership of the skill.

## Code Example (Backend - Node.js with `@solana/web3.js`)

```javascript
// POST /api/marketplace/skills/purchase
router.post('/skills/purchase', async (req, res) => {
    const { signature, skillName, agentId } = req.body;
    const userId = req.session.userId;

    // 1. Fetch transaction details from the blockchain
    const connection = new solanaWeb3.Connection(solanaWeb3.clusterApiUrl('devnet'));
    const tx = await connection.getTransaction(signature);

    // 2. Verify the transaction's details (amount, recipient, etc.)
    const isValid = verifyTransaction(tx, { /* expected details */ });

    if (isValid) {
        // 3. Record the purchase in the database
        await db.recordSkillPurchase(userId, skillName, agentId);
        res.status(200).json({ success: true });
    } else {
        res.status(400).json({ error: 'Invalid transaction' });
    }
});
```
