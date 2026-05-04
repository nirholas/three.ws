# Prompt 5: Transaction Confirmation (Backend)

## Objective
Implement a backend mechanism to verify that a Solana Pay transaction has been successfully processed and confirmed on the blockchain.

## Explanation
After the user approves the transaction in their wallet, we need a reliable way to confirm its success on the backend. The Solana Pay spec provides a mechanism for this. The wallet will make a `GET` request to the same URL it used for the `POST`, and our backend should verify the transaction signature provided by the wallet.

## Instructions
1.  **Modify the Payment Endpoint (`api/payments/prepare-skill-purchase.js`):**
    *   Our endpoint needs to handle both `POST` (to create the transaction) and `GET` (to verify it).
    *   **For the `POST` request:** When creating the transaction, you must associate it with a unique reference `PublicKey`. This reference key allows you to look up the transaction later. Generate a new keypair for each transaction: `const reference = new Keypair().publicKey;`. Add this reference to the `transfer` instruction. Store this reference in your database, linked to the user, skill, and agent.
    *   **For the `GET` request:** The wallet will include the transaction `signature` in the query string. Your handler should:
        *   Find the transaction on the blockchain using the `signature`.
        *   Verify that the transaction was successful and contains the expected transfers (to the creator and the platform).
        *   Crucially, verify that the transaction includes the `reference` public key you generated, proving it's for this specific purchase.
        *   If everything checks out, proceed to the next step: granting the user access to the skill.

## Code Example (Backend - `api/payments/prepare-skill-purchase.js`)

This example shows the conceptual additions. You'll need to integrate this with your database logic.

```javascript
// ... imports including Keypair
import { Keypair } from '@solana/web3.js';
import { findTransaction, verifyTransaction } from '@solana/pay';

// ... DB function placeholders
import { savePurchaseReference, findPurchaseByReference, grantSkillToUser } from '../_lib/db';

export default async function handler(req, res) {
    const connection = new Connection(process.env.SOLANA_RPC_URL);

    if (req.method === 'POST') {
        // ... POST logic from prompt 3 ...
        
        // 1. Generate a reference keypair
        const reference = new Keypair().publicKey;

        // 2. Add it to the transaction so you can find it later
        // This is a simplified example; typically added to the transfer instruction
        transaction.add(
            SystemProgram.transfer({
                fromPubkey: buyerPublicKey,
                toPubkey: reference, // Using reference here is for lookup
                lamports: 0,
            })
        );
        
        // 3. Save reference to DB before sending tx to user
        await savePurchaseReference(reference.toBase58(), { userId: req.user.id, agentId, skillName });
        
        // ... continue serializing and sending transaction
    } else if (req.method === 'GET') {
        try {
            const { reference, signature } = req.query;
            if (!reference || !signature) {
                return res.status(400).json({ error: 'Missing reference or signature' });
            }

            // Find the purchase details from your DB using the reference
            const purchaseDetails = await findPurchaseByReference(reference);
            if (!purchaseDetails) {
                return res.status(404).json({ error: 'Purchase reference not found' });
            }

            // Use Solana Pay's helper to find and verify the transaction
            const { transaction, status } = await findTransaction(connection, new PublicKey(signature));

            if (status !== 'confirmed') {
                 return res.status(400).json({ error: 'Transaction not confirmed' });
            }

            // You should add more robust verification here:
            // - Check the amounts transferred
            // - Check the destination addresses
            // - Check that the buyer was the fee payer
            console.log('Transaction verified successfully!');

            // Grant access to the skill
            await grantSkillToUser(purchaseDetails.userId, purchaseDetails.skillName);

            res.status(200).json({ status: 'ok', message: 'Purchase confirmed!' });

        } catch (error) {
            console.error('Verification failed:', error);
            res.status(500).json({ error: 'Verification failed' });
        }
    } else {
        res.status(405).json({ error: 'Method Not Allowed' });
    }
}

```
