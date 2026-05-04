---
status: not-started
---

# Prompt 05: Solana Pay Transaction Integration

## Objective
Integrate Solana Pay into the purchase modal to generate a transaction for the user to sign.

## Explanation
When the user clicks "Confirm Purchase", we need to construct and present a Solana transaction. We'll use the Solana Pay standard, which allows for reliable transaction requests. The backend will create the transaction, and the frontend will use it.

## Instructions
- [ ] **Create a Backend Endpoint for Transaction Creation:**
    - [ ] Create a new API endpoint, e.g., `POST /api/transactions/create-skill-purchase`.
    - [ ] This endpoint will take `agentId`, `skillName`, and the `buyerPublicKey` as input.
    - [ ] It should look up the skill price, the creator's destination wallet, and the platform fee wallet.
    - [ ] Using the Solana SDK (`@solana/web3.js`), it will construct a transaction that transfers the correct amount of USDC from the buyer to the creator (and platform).
    - [ ] The endpoint should return the serialized transaction.

- [ ] **Update Frontend Modal Logic:**
    - [ ] In `src/marketplace.js`, modify the event listener for the "Confirm Purchase" button (`#modal-confirm-btn`).
    - [ ] When clicked, it should first check if the user's wallet is connected.
    - [ ] Then, it should make a `POST` request to your new backend endpoint.
    - [ ] The frontend receives the serialized transaction from the backend.

- [ ] **Sign and Send the Transaction:**
    - [ ] Use the wallet-adapter's `sendTransaction` method to ask the user to sign and send the transaction received from the backend.
    - [ ] Handle potential errors during this process (e.g., user rejection).

## JavaScript Example (`src/marketplace.js` - Confirm Button Listener)

```javascript
const confirmBtn = document.getElementById('modal-confirm-btn');
confirmBtn.addEventListener('click', async () => {
    if (!wallet.connected) {
        alert('Please connect your wallet first.');
        return;
    }

    // Get details from modal/app state
    const skillName = document.getElementById('modal-skill-name').textContent;
    const buyerPublicKey = wallet.publicKey.toBase58();

    try {
        // 1. Fetch transaction from backend
        const response = await fetch('/api/transactions/create-skill-purchase', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ skillName, agentId: currentAgent.id, buyerPublicKey }),
        });
        const { transaction } = await response.json();

        // 2. Deserialize and send
        const connection = new solanaWeb3.Connection(solanaWeb3.clusterApiUrl('devnet'));
        const tx = solanaWeb3.Transaction.from(Buffer.from(transaction, 'base64'));
        
        const signature = await wallet.sendTransaction(tx, connection);
        
        // 3. Start polling for confirmation (covered in next prompt)
        console.log('Transaction sent with signature:', signature);
        await connection.confirmTransaction(signature, 'processed');
        alert('Purchase successful!');

    } catch (error) {
        console.error('Purchase failed', error);
        alert('Purchase failed. See console for details.');
    }
});
```
