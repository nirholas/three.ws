---
status: not-started
last_updated: 2026-05-04
---
# Prompt 15: Gasless Transactions (Payer Sponsorship)

## Objective
Implement a "gasless" transaction system where the platform sponsors the Solana network fees for skill purchases, improving the user experience.

## Explanation
Users often don't have SOL in their wallets, even if they have USDC. Forcing them to acquire SOL just to pay for a minor gas fee is a major point of friction. We can sponsor these transactions. The user still signs the token transfer, but our backend pays the associated SOL fee. This is done using Solana's "Versioned Transactions" with a Payer.

## Instructions
1.  **Platform Payer Keypair:**
    *   Create a dedicated Solana keypair for the platform, which will be used to pay for transaction fees.
    *   Store this keypair's secret key securely in the backend environment (e.g., in a secrets manager).
    *   This wallet must be funded with SOL.

2.  **Modify Purchase Preparation API (`purchase-prep`):**
    *   Instead of creating a "Legacy" `Transaction`, you will now create a `VersionedTransaction`.
    *   The `feePayer` of the transaction will now be the **platform's payer public key**.
    *   The user's public key is still the one signing the token transfer instruction itself.
    *   After adding the transfer instructions, the transaction is **partially signed by the platform's payer keypair on the backend**.
    *   The serialized transaction sent to the frontend is now a partially signed `VersionedTransaction`.

3.  **Modify Frontend Signing Logic:**
    *   The frontend will receive the partially signed, versioned transaction.
    *   The `wallet.signTransaction` method works the same way for the user; they are just signing a transaction where they are not the fee payer.
    *   The rest of the flow (send, confirm) remains largely the same.

## Code Example (Backend `purchase-prep` API)

```javascript
import {
    Connection,
    PublicKey,
    TransactionMessage,
    VersionedTransaction,
    Keypair
} from '@solana/web3.js';
// ...

// Load your platform's payer keypair securely
const platformPayer = Keypair.fromSecretKey(Buffer.from(process.env.PAYER_SECRET_KEY, 'base64'));

// ... Inside the endpoint logic
export default wrap(async (req, res) => {
    // ...
    // The buyer is still the authority for the transfer, but not the fee payer
    const buyerPublicKey = new PublicKey(user.wallet_address);

    const instructions = [
        // ... createTransferInstruction for creator payout
        // ... createTransferInstruction for platform fee
    ];

    const { blockhash } = await connection.getLatestBlockhash();
    const messageV0 = new TransactionMessage({
        payerKey: platformPayer.publicKey, // PLATFORM pays the fee
        recentBlockhash: blockhash,
        instructions,
    }).compileToV0Message();

    const tx = new VersionedTransaction(messageV0);

    // The user's wallet will provide the signature for the token transfer
    // We sign it with our payer key to cover the fees
    tx.sign([platformPayer]);

    const serializedTx = Buffer.from(tx.serialize()).toString('base64');

    return json(res, 200, { transaction: serializedTx });
});
```
