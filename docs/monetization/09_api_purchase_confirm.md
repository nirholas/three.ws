---
status: not-started
last_updated: 2026-05-04
---
# Prompt 09: Backend API for Purchase Confirmation

## Objective
Create a backend endpoint to verify a skill purchase transaction on-chain and record it in the database.

## Explanation
After the frontend successfully broadcasts the transaction, it must notify the backend. This endpoint's job is to act as a final "source of truth." It verifies that the transaction signature provided by the client is valid, that it corresponds to the intended purchase, and that it was successful. Only after this verification does it save the purchase record to the `user_purchased_skills` table.

## Instructions
1.  **Create the API Endpoint:**
    *   Create a new file or handler for `POST /api/skills/purchase-confirm`.

2.  **Implement the Logic:**
    *   **Authentication:** The user must be authenticated.
    *   **Input Validation:** The request body should contain `agent_id`, `skill_name`, and `signature`.
    *   **Fetch Purchase Details:**
        *   Retrieve the skill price and creator's wallet address, just as in the "prep" step. This is to ensure the on-chain transaction matches what we expected.
    *   **On-Chain Verification:**
        *   Use the Solana `connection.getParsedTransaction` method with the provided `signature`.
        *   Inspect the transaction details to confirm:
            *   The transaction was successful ( `tx.meta.err` is null).
            *   The source account matches the buyer's wallet.
            *   The destination account matches the creator's wallet.
            *   The transfer amount matches the skill price.
            *   The token mint matches the currency (e.g., USDC).
        *   This step is critical to prevent users from submitting fraudulent or irrelevant transaction signatures.
    *   **Database Operation:**
        *   If on-chain verification passes, insert a new record into the `user_purchased_skills` table. Store all relevant details, including the transaction signature, for auditing.

## Code Example (Vercel Serverless Function)

```javascript
import { Connection } from '@solana/web3.js';
import { sql } from '../../_lib/db.js';
// ... other imports

export default wrap(async (req, res) => {
    // ... auth and input validation
    const { agent_id, skill_name, signature } = req.body;
    const user = await getSessionUser(req);
    const buyerWallet = user.wallet_address;

    // 1. Fetch expected details for verification
    const [skillPrice] = await sql`SELECT ...`;
    const [agent] = await sql`SELECT ...`;
    const creatorWallet = agent.meta.onchain.wallet;
    const expectedAmount = skillPrice.amount;
    const currencyMint = skillPrice.currency_mint;

    // 2. Verify transaction on-chain
    const connection = new Connection(rpcUrl('mainnet-beta'), 'confirmed');
    const tx = await connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0 });

    if (!tx || tx.meta.err) {
        return error(res, 400, 'tx_failed', 'Transaction failed or not found.');
    }

    // Find the token transfer instruction
    const transferInstruction = tx.transaction.message.instructions.find(ix =>
        ix.parsed?.type === 'transfer' &&
        ix.program === 'spl-token'
    );

    if (!transferInstruction) {
        return error(res, 400, 'invalid_tx', 'No token transfer found in transaction.');
    }

    const { source, destination, amount } = transferInstruction.parsed.info;
    // Note: A robust implementation would resolve ATAs to owner wallets.
    // This is a simplified check.
    if (source !== buyerWalletAta || destination !== creatorWalletAta || amount !== expectedAmount) {
         return error(res, 400, 'tx_mismatch', 'Transaction details do not match expected purchase.');
    }

    // 3. Record the purchase in the database
    await sql`
        INSERT INTO user_purchased_skills
            (user_id, agent_id, skill_name, purchase_tx_signature, price_amount, price_currency_mint)
        VALUES
            (${user.id}, ${agent_id}, ${skill_name}, ${signature}, ${expectedAmount}, ${currencyMint})
        ON CONFLICT (user_id, agent_id, skill_name) DO NOTHING;
    `;

    return json(res, 201, { success: true, message: 'Purchase confirmed and recorded.' });
});
```
