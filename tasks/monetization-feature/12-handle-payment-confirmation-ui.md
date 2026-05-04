# Prompt 12: Handle Payment Confirmation UI

## Objective
Update the frontend JavaScript to call the `/api/payments/confirm` endpoint after a Solana transaction is confirmed, and display appropriate success or error messages to the user in the payment modal.

## Explanation
The loop is almost closed. The frontend has a confirmed transaction signature (`txid`), and the backend has an endpoint to verify it. Now we need to connect the two. The `handlePurchase` function will be extended to send the `txid` and `intent_id` to our backend, effectively finalizing the purchase in our system. The UI needs to provide clear feedback throughout this final verification step.

## Instructions
1.  **Locate the Frontend Logic:**
    *   Open `src/marketplace.js` and find the `handlePurchase` function created in Prompt 10.

2.  **Add the API Call:**
    *   Inside the `try` block, immediately after `solanaConnection.confirmTransaction` successfully completes, add a `fetch` call.
    *   `POST` to `/api/payments/confirm`.
    *   The body of the request must include the `intent_id` and the `transaction_signature` (`txid`).
    *   Remember to include `credentials: 'include'` and the correct `Content-Type` header.

3.  **Handle API Response:**
    *   Check if the response is `ok`. If not, throw an error with the message from the API's JSON response. This will be caught by the `catch` block.
    *   If the response is successful, the purchase is officially complete.

4.  **Update UI Feedback:**
    *   Change the status messages in the modal to reflect the new step.
        *   Before the API call: "Verifying purchase with server..."
        *   On API success: "Success! Skill unlocked."
        *   On API failure (in the `catch` block): "There was an issue verifying your purchase. Please contact support."
    *   After a successful confirmation, you can close the modal after a short delay.

## Code Example (Frontend - `src/marketplace.js`)

```javascript
// This is an updated version of the handlePurchase function from Prompt 10

async function handlePurchase() {
    const statusEl = $('payment-status');
    const confirmBtn = $('payment-confirm-btn');
    confirmBtn.disabled = true;
    statusEl.textContent = 'Building transaction...';
    statusEl.className = 'payment-status';

    const intentId = document.getElementById('payment-modal-overlay').dataset.intentId;
    if (!intentId) {
        statusEl.textContent = 'Error: Missing payment intent ID.';
        statusEl.classList.add('err');
        return;
    }

    try {
        const intent = await getCurrentIntentDetails(intentId); // Placeholder
        if (!wallet.publicKey) throw new Error('Wallet is not connected.');

        statusEl.textContent = 'Please approve the transaction in your wallet...';
        const transaction = await buildUsdcTransferTransaction(intent, wallet.publicKey);
        const txid = await wallet.sendTransaction(transaction, solanaConnection);
        
        statusEl.textContent = `Waiting for on-chain confirmation...`;
        const confirmation = await solanaConnection.confirmTransaction(txid, 'confirmed');
        if (confirmation.value.err) throw new Error('On-chain transaction failed.');

        statusEl.textContent = 'Verifying purchase with server...';

        const verifyRes = await fetch('/api/payments/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                intent_id: intentId,
                transaction_signature: txid,
            }),
        });

        const verifyBody = await verifyRes.json();
        if (!verifyRes.ok) {
            throw new Error(verifyBody.error_description || 'Failed to verify purchase.');
        }

        statusEl.textContent = 'Success! Skill unlocked.';
        statusEl.classList.add('ok');
        
        // In the next prompt, we will add logic to update the UI permanently
        // fireEvent('skill:purchased', { skillName: intent.payload.skill });

        setTimeout(closePaymentModal, 2000);

    } catch (error) {
        statusEl.textContent = `Error: ${error.message}`;
        statusEl.classList.add('err');
        console.error("Purchase failed", error);
        confirmBtn.disabled = false; // Re-enable on failure
    }
}
```
