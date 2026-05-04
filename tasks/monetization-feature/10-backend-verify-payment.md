---
status: not-started
---

# Prompt 10: Backend - Verify Payment and Unlock Skill

## Objective
Create a backend process to verify Solana Pay transactions and grant the purchased skill to the user upon confirmation.

## Explanation
After the user approves the transaction, our backend needs to confirm that the payment was successfully made. We will do this by polling the Solana blockchain for the transaction signature associated with our unique reference key. Once verified, we will record the purchase and create a record that the user now owns the skill.

## Instructions
1.  **Create a Verification Endpoint or Process:**
    *   This can be a new API endpoint that the frontend polls (e.g., `/api/payments/verify-transaction?reference=...`) or a background worker.
    *   Given a `reference` public key, the process should:
        *   Use the Solana `findReference` method from `@solana/pay` to find the transaction signature.
        *   This method will repeatedly query the chain until the transaction is found or it times out.

2.  **Validate the Transaction:**
    *   Once the transaction is found, validate its details:
        *   Check that the recipient, amount, and SPL token mint match the expected values for the skill purchase.
        *   This step is crucial to prevent users from sending incorrect payments and wrongly getting access.

3.  **Grant the Skill:**
    *   If validation passes, update the user's record to indicate they own the skill.
    *   Create a new table, `unlocked_agent_skills`, with `user_id` and `skill_id` to store this relationship.
    *   Update your `skill_purchases` table to mark the purchase as `completed`.

## Code Example (Verification Endpoint)

```javascript
import { findReference, validateTransfer } from '@solana/pay';
import { Connection, clusterApiUrl, PublicKey } from '@solana/web3.js';

// ... db connection

export default async function handler(req, res) {
    const { reference } = req.query;
    if (!reference) {
        return res.status(400).json({ error: 'Reference key is required' });
    }

    try {
        const connection = new Connection(clusterApiUrl('mainnet-beta'));
        const referencePubkey = new PublicKey(reference);

        // 1. Find the transaction
        const signature = await findReference(connection, referencePubkey, { finality: 'confirmed' });

        // 2. Get purchase details from our DB
        const purchase = await getPendingPurchaseByReference(reference);
        if (!purchase) {
             return res.status(404).json({ status: 'not_found' });
        }

        // 3. Validate the transaction against our records
        await validateTransfer(
            connection,
            signature,
            {
                recipient: new PublicKey(purchase.creator_wallet),
                amount: new BigNumber(purchase.amount / 1e6),
                splToken: new PublicKey(purchase.currency_mint),
                reference: referencePubkey,
            },
            { commitment: 'confirmed' }
        );

        // 4. If validation doesn't throw, grant the skill
        await grantSkillToUser(purchase.user_id, purchase.skill_id);
        await markPurchaseAsComplete(purchase.id);

        res.status(200).json({ status: 'confirmed' });

    } catch (error) {
        if (error.message.includes('not found')) {
            res.status(202).json({ status: 'pending' });
        } else {
            res.status(500).json({ status: 'error', message: error.message });
        }
    }
}
```
