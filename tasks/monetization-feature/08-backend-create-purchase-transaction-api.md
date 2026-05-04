---
status: not-started
---

# Prompt 8: Backend - Create Purchase Transaction API

## Objective
Create a backend API endpoint to generate Solana Pay transaction requests for skill purchases.

## Explanation
To allow users to buy skills, we need an API that can create a Solana Pay transaction on demand. This endpoint will be called by the frontend when a user clicks the "Purchase" button. It will generate a unique transaction reference and return the necessary details for the frontend to display a Solana Pay QR code.

## Instructions
1.  **Create the API Endpoint:**
    *   Create a new file, e.g., `api/payments/create-transaction.js`.
    *   This endpoint should accept `skill_id` and the `buyer_wallet_address` as input.
    *   It should be a `POST` request and require authentication.

2.  **Implement the Logic:**
    *   Fetch the skill's price from the `agent_skill_prices` table.
    *   Fetch the creator's wallet address from the `users` table.
    *   Use the Solana Pay SDK to construct a transaction that transfers the correct amount of USDC from the buyer to the creator.
    *   Generate a unique reference public key for this transaction. This is crucial for tracking the payment status later.
    *   Store the pending transaction details (e.g., reference, skill_id, buyer_id) in a new `skill_purchases` table.
    *   Return the Solana Pay URL (`solana:....`) and the `reference` public key to the frontend.

## Code Example (`api/payments/create-transaction.js`)

```javascript
import { Keypair } from '@solana/web3.js';
import { createQR, encodeURL } from '@solana/pay';
// ... other imports for db, etc.

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { skillId, buyerAddress } = req.body;
    const userId = req.session.userId; // Assuming you have auth middleware

    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    // 1. Fetch skill price and creator's wallet
    const { price, creatorWallet } = await getSkillPriceAndCreator(skillId);
    if (!price) {
        return res.status(404).json({ error: 'Skill not found or not for sale' });
    }

    // 2. Generate a reference keypair for the transaction
    const reference = new Keypair().publicKey;

    // 3. Store pending purchase
    await recordPendingPurchase(userId, skillId, reference.toBase58());

    // 4. Create Solana Pay URL
    const url = encodeURL({
        recipient: creatorWallet,
        amount: new BigNumber(price.amount / 1e6), // Convert to decimal representation
        splToken: new PublicKey(price.currency_mint),
        reference,
        label: `Skill Purchase: ${skillName}`,
        memo: `SKILL:${skillId}`,
    });

    // 5. Return details to frontend
    res.status(200).json({
        solanaPayUrl: url.toString(),
        reference: reference.toBase58(),
    });
}
```
