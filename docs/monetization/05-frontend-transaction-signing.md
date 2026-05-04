# Prompt 5: Frontend Transaction Signing

## Objective
Implement the frontend logic to take the serialized transaction from the backend, have the user sign it with their connected wallet, and send it to the Solana network.

## Explanation
This is the crucial step where the user approves the purchase. The frontend receives the base64-encoded transaction from the backend purchase endpoint. It then needs to decode it, present it to the user's wallet for signing, and upon approval, submit the signed transaction to the blockchain for confirmation.

## Instructions
1.  **Add Frontend API Call:**
    *   In `src/marketplace.js`, within the event handler for the "Buy Now" button in the purchase modal, make a `fetch` POST request to your new `/api/marketplace/skills/purchase` endpoint.
    *   Send the `agentId`, `skillName`, and the connected user's public key in the request body.

2.  **Sign and Send Transaction:**
    *   On a successful response from the API, you will receive the serialized transaction.
    *   You need to deserialize it, request the user's wallet to sign it, and then send the raw, signed transaction to the Solana network.

## Code Example (`src/marketplace.js`)

```javascript
import { Connection, Transaction, clusterApiUrl } from '@solana/web3.js';

// Inside the confirmPurchaseBtn click listener
confirmPurchaseBtn.addEventListener('click', async () => {
    const skillName = confirmPurchaseBtn.dataset.skillName;
    // Assume `agent` and `walletPublicKey` are available in this scope
    const agentId = agent.id;
    const purchaserPublicKey = walletPublicKey.toBase58();

    try {
        // 1. Get transaction from the backend
        const response = await fetch('/api/marketplace/skills/purchase', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentId, skillName, purchaserPublicKey }),
        });
        
        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error || 'Failed to prepare transaction.');
        }

        const { transaction: base64Transaction } = await response.json();
        
        // 2. Deserialize, sign, and send
        const provider = getProvider(); // The wallet provider from prompt 2
        const connection = new Connection(clusterApiUrl('devnet'));

        const transaction = Transaction.from(Buffer.from(base64Transaction, 'base64'));

        // 3. Request user to sign
        const { signature } = await provider.signAndSendTransaction(transaction, connection);
        
        // 4. Confirm transaction
        await connection.confirmTransaction(signature, 'confirmed');

        alert(`Purchase successful! Transaction: ${signature}`);
        
        // Next step: Call another backend endpoint to formally unlock the skill
        // This will be covered in another prompt.
        closePurchaseModal();

    } catch (error) {
        console.error('Purchase failed:', error);
        alert(`Purchase failed: ${error.message}`);
    }
});
```
