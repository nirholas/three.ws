---
status: not-started
---

# Prompt 10: Backend - Transaction Verification and Fulfillment

## Objective
Create a backend mechanism to securely verify a Solana transaction and, upon success, record the skill ownership in the database.

## Explanation
A crucial security step is to verify the payment on the backend *after* the frontend reports it as confirmed. The frontend can be manipulated, so the server must independently fetch the transaction details from the Solana RPC and validate them before granting access to the skill. This is the "fulfillment" step of the purchase.

## Instructions
1.  **Create a Verification API Endpoint:**
    *   Create a new API file, e.g., `api/payments/verify-transaction.js`.
    *   This endpoint will accept a `POST` request at `/api/payments/verify-transaction`.
    *   The frontend will call this endpoint *after* it has successfully confirmed the transaction on its end.

2.  **Request Body and Authentication:**
    *   The request body should contain:
        *   `signature`: The transaction signature returned by `sendRawTransaction`.
        *   `agentId`: The agent ID for the skill purchased.
        *   `skillName`: The name of the skill purchased.
    *   This endpoint must be authenticated to get the `userId` of the purchaser.

3.  **Backend Verification Logic:**
    *   Inside the API handler:
        1.  **Fetch Transaction:** Use the Solana `connection.getParsedTransaction(signature)` method to get the transaction details from the RPC.
        2.  **Prevent Replay Attacks:** Check if this `signature` has already been used to unlock a skill in your `user_unlocked_skills` table. If it exists, return an error. This is critical.
        3.  **Fetch Skill Price:** Get the expected price (`amount`, `currency_mint`) and the creator's wallet address from your database for the given `agentId` and `skillName`.
        4.  **Validate Details:** Parse the fetched transaction and verify that:
            *   It was successful (the `meta.err` field in the response is `null`).
            *   It contains a token transfer instruction.
            *   The transfer's `source` address belongs to the authenticated user (`userId`).
            *   The transfer's `destination` address belongs to the agent's creator.
            *   The transfer `amount` matches the expected price from your database.
            *   The transfer `mint` matches the expected currency from your database.
        5.  **Handle Failure:** If any of these checks fail, return a `400 Bad Request` or `422 Unprocessable Entity` error with a clear message.

4.  **Record Ownership:**
    *   If all checks pass, `INSERT` a new row into the `user_unlocked_skills` table with the `userId`, `agentId`, `skillName`, `purchase_tx_signature`, and the price details.

5.  **Return Success:**
    *   Return a `200 OK` response to the frontend to confirm that the backend has successfully verified and fulfilled the purchase.

## Code Example (`api/payments/verify-transaction.js`)

```javascript
import { Connection, PublicKey } from '@solana/web3.js';
import { json, wrap } from '../_lib/http.js';
import { getAuth } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';

const connection = new Connection(process.env.SOLANA_RPC_ENDPOINT);

export default wrap(async (req, res) => {
    // ... authentication ...
    const { userId } = await getAuth(req);
    const { signature, agentId, skillName } = req.body;

    // 1. Check for replay attacks
    const [existing] = await sql`SELECT id FROM user_unlocked_skills WHERE purchase_tx_signature = ${signature}`;
    if (existing) {
        return json(res, 409, { error: 'Transaction has already been used.' });
    }

    // 2. Fetch expected price and creator info from DB
    // ... query to get priceInfo and creatorWallet ...
    
    // 3. Fetch and parse the transaction from Solana RPC
    const tx = await connection.getParsedTransaction(signature, 'confirmed');
    if (!tx || tx.meta.err) {
        return json(res, 400, { error: 'Transaction not found or failed.' });
    }

    // 4. Validate the transaction details (this is a simplified example)
    const transfer = tx.transaction.message.instructions.find(
        (ix) => ix.parsed?.type === 'transfer' && ix.program === 'spl-token'
    );
    
    if (!transfer) {
        return json(res, 400, { error: 'No valid SPL token transfer found.' });
    }

    const { source, destination, amount } = transfer.parsed.info;
    // You would also need to verify the owner of the source account matches the user.
    // This requires more complex parsing of account data.

    const expectedAmount = priceInfo.amount.toString();
    const expectedDestination = creatorTokenAccountAddress; // You need to derive this

    if (amount !== expectedAmount || destination !== expectedDestination) {
        return json(res, 400, { error: 'Transaction details do not match expected values.' });
    }

    // 5. If all checks pass, record the purchase
    await sql`
        INSERT INTO user_unlocked_skills (user_id, agent_id, skill_name, purchase_tx_signature, purchase_amount, purchase_currency_mint)
        VALUES (${userId}, ${agentId}, ${skillName}, ${signature}, ${priceInfo.amount}, ${priceInfo.currency_mint})
    `;

    return json(res, 200, { success: true, message: 'Skill unlocked.' });
});
```
