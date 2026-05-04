# Prompt 06: Transaction Status Polling and Verification

## Objective
After a transaction is sent, reliably confirm its success by polling a Solana RPC endpoint and then verifying it on the backend.

## Explanation
Sending a transaction to the network doesn't guarantee its success. We must confirm it has been processed and finalized. The frontend will poll for initial confirmation to give the user quick feedback, and the backend will do a final verification before unlocking the skill.

## Instructions
1.  **Frontend: Poll for Confirmation:**
    *   After sending the transaction with `sendTransaction`, the wallet adapter returns a transaction signature (txid).
    *   Use the `Connection` object's `confirmTransaction` method. This will poll the RPC until the transaction reaches a certain commitment level (e.g., 'processed' or 'confirmed').
    *   While polling, update the UI to show a "Processing..." state in the purchase modal.

2.  **Backend: Create a Verification Endpoint:**
    *   Create a new backend endpoint, e.g., `POST /api/skills/purchase/verify`.
    *   This endpoint will receive the `transactionSignature`.
    *   On the backend, use the Solana SDK to fetch the transaction details using the signature.

3.  **Backend: Verify Transaction Details:**
    *   In the verification endpoint, inspect the fetched transaction.
    *   Confirm that the transaction involves the correct sender (buyer), receiver (creator), and amount (price). This is a critical security step to prevent users from submitting fake or incorrect transaction signatures.
    *   If the transaction is valid, proceed to record the skill ownership (covered in the next prompt).

## JavaScript Example (`src/marketplace.js` - inside confirm button handler)

```javascript
// ... after const signature = await wallet.sendTransaction(tx, connection);

// Show processing state in UI
setModalState('processing'); 

const { value: status } = await connection.confirmTransaction(signature, 'confirmed');

if (status.err) {
    console.error('Transaction failed to confirm', status.err);
    setModalState('error', 'Transaction Failed');
    return;
}

// Now that frontend has confirmation, send signature to backend for final verification
try {
    const verifyResponse = await fetch('/api/skills/purchase/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionSignature: signature, agentId: currentAgent.id, skillName }),
    });

    if (!verifyResponse.ok) throw new Error('Backend verification failed');
    
    setModalState('success', 'Purchase Complete!');
    // Update UI to show skill as unlocked (covered in next prompt)

} catch (error) {
    console.error('Backend verification failed', error);
    setModalState('error', 'Verification Failed');
}
```
