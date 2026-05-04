---
status: not-started
last_updated: 2026-05-04
---
# Prompt 07: Backend API for Purchase Preparation

## Objective
Create a backend endpoint that prepares an on-chain transaction for a user to purchase a skill.

## Explanation
When a user clicks the "Purchase" button, the frontend needs to request a transaction from the backend. This endpoint will not execute the transaction but will prepare it. It will construct a Solana transaction that, when signed by the user, will transfer the correct amount of USDC from the user's wallet to the agent creator's wallet. This is a crucial step for security and a smooth user experience.

## Instructions
1.  **Create the API Endpoint:**
    *   Create a new file or handler, e.g., `POST /api/skills/purchase-prep`.

2.  **Implement the Logic:**
    *   **Authentication:** Ensure the user is authenticated.
    *   **Input Validation:** The request body should contain the `agent_id` and `skill_name`. Validate these inputs.
    *   **Fetch Data:**
        *   Retrieve the skill's price from the `agent_skill_prices` table.
        *   Retrieve the agent creator's wallet address from the `agent_identities` table (`meta.onchain.wallet`).
        *   Retrieve the buyer's wallet address from their session or a trusted source.
    *   **Construct Transaction:**
        *   Using the Solana Web3.js library (`@solana/web3.js`), create a new transaction.
        *   The transaction should contain one primary instruction: a `spl-token` transfer from the buyer's USDC associated token account (ATA) to the creator's USDC ATA.
        *   The amount should be the price fetched from the database.
        *   The transaction's `feePayer` should be set to the buyer's public key.
    *   **Serialization:**
        *   Serialize the transaction without signing it.
        *   Return the serialized transaction as a base64-encoded string. This is what the frontend will receive and pass to the user's wallet to be signed.
    *   **Record Preparation:**
        *   It's good practice to store a temporary record of this preparation step (e.g., in Redis or a `skill_purchase_preparations` table) with an expiration time, to prevent replay attacks and to link it to the confirmation step.

## Code Example (Vercel Serverless Function)

```javascript
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { getOrCreateAssociatedTokenAccount, createTransferInstruction } from '@solana/spl-token';
import { sql } from '../../_lib/db.js';
// ... other imports

export default wrap(async (req, res) => {
    // ... auth and validation
    const { agent_id, skill_name } = req.body;
    const user = await getSessionUser(req);
    const buyerPublicKey = new PublicKey(user.wallet_address);

    // 1. Fetch skill price and creator wallet
    const [skillPrice] = await sql`...`;
    const [agent] = await sql`...`;
    const creatorPublicKey = new PublicKey(agent.meta.onchain.wallet);
    const usdcMint = new PublicKey(skillPrice.currency_mint);

    // 2. Setup connection and ATAs
    const connection = new Connection(rpcUrl('mainnet-beta'));
    const buyerAta = await getOrCreateAssociatedTokenAccount(connection, buyerPublicKey, usdcMint, buyerPublicKey);
    const creatorAta = await getOrCreateAssociatedTokenAccount(connection, buyerPublicKey, usdcMint, creatorPublicKey);

    // 3. Create transaction
    const { blockhash } = await connection.getLatestBlockhash();
    const tx = new Transaction({
        feePayer: buyerPublicKey,
        recentBlockhash: blockhash,
    });

    tx.add(
        createTransferInstruction(
            buyerAta.address,
            creatorAta.address,
            buyerPublicKey,
            skillPrice.amount
        )
    );

    // 4. Serialize and return
    const serializedTx = tx.serialize({ requireAllSignatures: false }).toString('base64');

    // 5. Save prep record (omitted for brevity)

    return json(res, 200, { transaction: serializedTx });
});
```
