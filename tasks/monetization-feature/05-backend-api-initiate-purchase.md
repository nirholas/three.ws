---
status: not-started
---
# Prompt 5: API to Initiate Skill Purchase

**Status:** Not Started

## Objective
Create a backend endpoint that prepares and returns a transaction for a user to sign to purchase a skill.

## Explanation
For on-chain payments, the backend should not handle private keys. Instead, it constructs an unsigned transaction and sends it to the client. The user then signs it with their wallet, ensuring a secure, non-custodial process. This endpoint will generate such a transaction.

## Instructions
- **Create a `POST` endpoint: `/api/skills/:skill_id/purchase`.**
- **Implement the following logic:**
    1.  **Authentication:** Ensure the user is logged in.
    2.  **Validation:** Check that the skill exists and is for sale.
    3.  **Fetch Data:** Get the skill price, creator's wallet address, and platform fee wallet address.
    4.  **Construct Transaction:** Use the Solana Web3 library (`@solana/web3.js`) to create a transaction with two transfers:
        - One transfer sends the payment from the user to the creator.
        - A second transfer sends the platform fee from the user to the platform wallet.
    5.  **Serialize:** Serialize the transaction, but do not sign it. Base64-encode the serialized transaction.
    6.  **Response:** Return the base64-encoded transaction to the client.

## Code Example (Backend - Solana Pay)
```javascript
// POST /api/skills/:skill_id/purchase
import { createTransfer } from '@solana/pay';
import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';

async function initiatePurchase(req, res) {
    const { skill_id } = req.params;
    const user_id = req.session.userId;
    const user_wallet = new PublicKey(req.body.account); // User's public key from request

    // ... Auth, validation ...
    const priceInfo = await db.one('SELECT * FROM agent_skill_prices WHERE skill_id = $1', skill_id);
    const creator = await db.one('SELECT wallet_address FROM users WHERE id = $1', priceInfo.creator_id);

    const connection = new Connection(process.env.SOLANA_RPC_URL);
    const creatorWallet = new PublicKey(creator.wallet_address);
    const platformWallet = new PublicKey(process.env.PLATFORM_WALLET);
    const feeAmount = priceInfo.amount * 0.05; // 5% fee

    const transaction = new Transaction({
        feePayer: user_wallet,
        recentBlockhash: (await connection.getLatestBlockhash()).blockhash
    });

    // Payment to creator
    transaction.add(SystemProgram.transfer({
        fromPubkey: user_wallet,
        toPubkey: creatorWallet,
        lamports: priceInfo.amount,
    }));
    
    // Fee to platform
    transaction.add(SystemProgram.transfer({
        fromPubkey: user_wallet,
        toPubkey: platformWallet,
        lamports: feeAmount,
    }));

    const serialized = transaction.serialize({ requireAllSignatures: false });
    return res.json({ transaction: serialized.toString('base64') });
}
```
