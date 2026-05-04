---
status: not-started
---
# Prompt 13: Sign and Send Transaction from Frontend

**Status:** Not Started

## Objective
Implement the logic to have the user's wallet sign the transaction received from the backend and broadcast it to the Solana network.

## Explanation
This is the core of the on-chain interaction. The frontend acts as a bridge between the backend (which creates the transaction) and the user's wallet (which holds the keys and signs). A successful broadcast returns a transaction signature.

## Instructions
- **This task builds on the previous one, using the `transaction` string.**
- **Create a `signAndSendTransaction` function.**
- **Inside this function:**
    1.  **Deserialize the Transaction:** The backend sent a base64-encoded string. You need to decode it and reconstruct the `Transaction` object.
    2.  **Sign the Transaction:** Use the `signTransaction` method from the wallet adapter. This will prompt the user in their wallet UI.
    3.  **Send the Transaction:** Use `connection.sendRawTransaction` to broadcast the signed transaction to the network.
    4.  **Confirm the Transaction:** Use `connection.confirmTransaction` to wait for the transaction to be finalized on the blockchain. This returns the signature.
    5.  **Fulfill the Purchase:** Call the backend fulfillment endpoint (`/api/skills/fulfill_purchase`) with the transaction signature.

## Code Example (Frontend - using `@solana/wallet-adapter` hooks)
```javascript
import { Connection, Transaction } from '@solana/web3.js';
// const { publicKey, signTransaction } = useWallet();
// const connection = new Connection(...);

async function signAndSendTransaction(base64Transaction) {
    if (!publicKey || !signTransaction) return;

    try {
        // 1. Deserialize
        const transactionBuffer = Buffer.from(base64Transaction, 'base64');
        const transaction = Transaction.from(transactionBuffer);

        // 2. Sign
        const signedTransaction = await signTransaction(transaction);

        // 3. Send
        const signature = await connection.sendRawTransaction(
            signedTransaction.serialize()
        );

        // 4. Confirm
        await connection.confirmTransaction(signature);
        
        console.log('Transaction successful with signature:', signature);

        // 5. Fulfill (call backend)
        await fulfillPurchaseOnBackend(signature);

    } catch (error) {
        console.error('Signing failed:', error);
        alert('Transaction was not approved or failed to send.');
    }
}
```
