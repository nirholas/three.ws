# Prompt 10: Send Solana Transaction

## Objective
Wire up the "Confirm Purchase" button to take the constructed transaction from the previous step, send it to the user's wallet for signing, and submit it to the Solana network.

## Explanation
This is the climax of the payment flow. The user has connected their wallet and is ready to pay. When they click the final confirmation button, we will:
1.  Build the transaction using the function from the previous prompt.
2.  Use the wallet adapter's `sendTransaction` method. This method first asks the user to approve and sign the transaction via their wallet's popup.
3.  If the user approves, the adapter sends the signed transaction to the Solana RPC.
4.  The method returns a transaction signature (ID).
5.  We will then wait for the transaction to be confirmed by the network.

## Instructions
1.  **Add Event Listener:**
    *   In `src/marketplace.js`, add an event listener to the `#payment-confirm-btn`. This should be done when the modal is opened or when the wallet connects.

2.  **Implement the Click Handler:**
    *   The handler should be `async`.
    *   Show a loading state (e.g., disable the button, show a "Processing..." message in the status area).
    *   Get the `intent_id` and other necessary data that you stored when opening the modal.
    *   Get the user's public key from `wallet.publicKey`.
    *   Call the `buildUsdcTransferTransaction` function from the previous prompt to get the transaction object.

3.  **Send the Transaction:**
    *   Call `wallet.sendTransaction(transaction, solanaConnection)`.
    *   This function will throw an error if the user rejects the signature, so wrap it in a `try...catch` block.
    *   The function returns a `txid` (transaction signature).

4.  **Confirm the Transaction:**
    *   Once you have the `txid`, use `solanaConnection.confirmTransaction(txid, 'confirmed')`. This will wait until the transaction is finalized on the blockchain.
    *   This is the point of success. You now have proof of payment.

5.  **Next Steps (to be handled in future prompts):**
    *   After confirmation, you will call your backend's `/api/payments/confirm` endpoint with the `txid`.
    *   For now, on success, simply show a success message in the modal's status area. On failure (user rejection, network error), show an appropriate error message.

## Code Example (Frontend - `src/marketplace.js`)

```javascript
// Add this event listener setup inside the updateWalletUI function,
// when the wallet is connected.

function updateWalletUI() {
    // ... inside the `if (wallet.connected)` block
    const confirmBtn = $('payment-confirm-btn');
    confirmBtn.disabled = false;
    
    // Make sure to remove old listeners if this function can be called multiple times
    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);

    newConfirmBtn.addEventListener('click', handlePurchase);
}

// Create the main purchase handler function
async function handlePurchase() {
    const statusEl = $('payment-status');
    const confirmBtn = $('payment-confirm-btn');
    confirmBtn.disabled = true;
    statusEl.textContent = 'Building transaction...';

    try {
        const intentId = document.getElementById('payment-modal-overlay').dataset.intentId;
        // You'll need to fetch the intent again or store it more robustly
        // For now, let's assume `currentIntent` is available
        const intent = await getCurrentIntentDetails(intentId); // Placeholder for fetching intent
        if (!wallet.publicKey) throw new Error('Wallet is not connected.');

        const transaction = await buildUsdcTransferTransaction(intent, wallet.publicKey);
        
        statusEl.textContent = 'Please approve the transaction in your wallet...';
        
        const txid = await wallet.sendTransaction(transaction, solanaConnection);
        statusEl.textContent = `Transaction sent! Waiting for confirmation... (${txid.slice(0, 8)}...)`;

        const confirmation = await solanaConnection.confirmTransaction(txid, 'confirmed');
        if (confirmation.value.err) {
            throw new Error(`Transaction failed: ${confirmation.value.err}`);
        }
        
        statusEl.textContent = 'Payment successful! Unlocking skill...';
        
        // In the next prompt, we will call our backend confirmation endpoint here.
        // For example: await confirmPaymentOnBackend(intentId, txid);

        setTimeout(() => {
            closePaymentModal();
        }, 2000);

    } catch (error) {
        statusEl.textContent = `Error: ${error.message}`;
        console.error("Purchase failed", error);
    } finally {
        // The button will be re-enabled if the modal is re-opened
    }
}

// A placeholder function - you'd need to implement this
// or pass the intent object around properly.
async function getCurrentIntentDetails(intentId) {
    // In a real app, you might re-fetch this from your server or have it stored
    // For now, we'll reconstruct it from the UI for this example
    const priceText = $('payment-price-display').textContent;
    const amount = Math.round(parseFloat(priceText.replace(' USDC', '')) * 1e6);
    // You would also need to get the recipient address and mint from the intent.
    // This highlights the need for better state management than just the DOM.
    
    // For now, let's return a dummy object. The real implementation would be more robust.
    return {
        recipient_address: '...', // You would need to fetch this
        amount: String(amount),
        currency_mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyB7u6a' // USDC
    }
}
```
