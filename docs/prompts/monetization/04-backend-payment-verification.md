---
status: not-started
---
# Prompt 4: Backend Payment Verification

## Objective
Create a backend endpoint to verify the Solana Pay transaction and confirm that the skill purchase was successful.

## Explanation
After the user completes the payment, the frontend needs to confirm with the backend that the transaction was valid. The backend will find the transaction on the Solana blockchain using the unique `reference` key we generated earlier, validate it, and update the purchase status in the database.

## Instructions
1.  **Create Verification Endpoint:**
    *   Create a new backend endpoint, e.g., `GET /api/payments/verify`.
    *   It should accept the `reference` public key as a query parameter.

2.  **Find and Validate Transaction:**
    *   Inside the endpoint, use the Solana Web3 JS library (`@solana/web3.js`) to connect to the blockchain.
    *   Use the `findReference` method to find the transaction signature associated with our `reference` public key.
    *   Once you have the signature, fetch the full transaction details.
    *   Verify that the transaction details (recipient, amount, SPL token mint) match the details stored in your `skill_purchases` table for the given reference. This is crucial for security.

3.  **Update Database:**
    *   If the transaction is valid, update the corresponding record in the `skill_purchases` table. Set its status from `pending` to `completed` and associate it with the user ID.
    *   The endpoint should return a success message.

4.  **Frontend Polling:**
    *   In the frontend payment modal, after displaying the QR code, start polling the `/api/payments/verify` endpoint every few seconds, sending the `reference` key.
    *   When the endpoint returns a success status, close the modal, show a "Purchase Successful" confirmation message, and refresh the agent detail view to show the skill as "Owned".

## Code Example (Backend - `/api/payments/verify.js`)
```javascript
import { Connection, PublicKey } from '@solana/web3.js';
import { findReference, validateTransfer } from '@solana/pay';
import BigNumber from 'bignumber.js';

// ... inside the endpoint handler ...

const { reference } = req.query;
if (!reference) {
    return res.status(400).json({ error: 'Reference key is required' });
}

// 1. Get purchase details from DB
const purchase = await db.getPendingPurchaseByReference(reference);
if (!purchase) {
    return res.status(404).json({ error: 'Pending purchase not found' });
}

// 2. Find transaction on-chain
const connection = new Connection(process.env.SOLANA_RPC_HOST);
const signatureInfo = await findReference(connection, new PublicKey(reference), { finality: 'confirmed' });

// 3. Validate transaction
await validateTransfer(
    connection,
    signatureInfo.signature,
    {
        recipient: new PublicKey(purchase.recipient),
        amount: new BigNumber(purchase.amount).dividedBy(1e6), // Convert to token units
        splToken: new PublicKey(purchase.spl_token_mint),
        reference: new PublicKey(reference),
    },
    { commitment: 'confirmed' }
);

// 4. If validation passes, update DB
await db.markPurchaseCompleted(reference, userId);

res.status(200).json({ status: 'verified' });
```
