# Prompt 21: Transaction Status Notifications

## Objective
Provide real-time feedback to the user about the status of their purchase transaction, from initiation to final confirmation.

## Explanation
Blockchain transactions aren't instant. A user needs clear, immediate feedback to know that their payment is being processed and to be notified of success or failure. This builds trust and improves the user experience significantly.

## Instructions
1.  **Update UI on Submission:**
    *   When the user clicks "Confirm Purchase" and approves the transaction in their wallet, immediately update the UI.
    *   Disable the purchase button and show a loading spinner with a message like "Processing transaction on the Solana blockchain..."

2.  **Use Connection Methods for Status:**
    *   The `@solana/web3.js` `Connection` object provides methods to track transaction status.
    *   After sending the transaction with `sendTransaction`, you get a `signature`.
    *   Use `connection.confirmTransaction(signature, 'processed')`. The promise returned by this method will resolve when the transaction is processed but not yet finalized. You can update the UI here to "Processing..."
    *   You can then use a second confirmation with commitment level `'confirmed'` or `'finalized'` for the final success message.

3.  **Display Success/Failure Messages:**
    *   On successful confirmation, hide the spinner and show a clear success message like, "Purchase complete! You now own the skill."
    *   If the transaction fails at any point (e.g., the promise from `sendTransaction` or `confirmTransaction` rejects), display a descriptive error message.
    *   Use a library like `notistack` or `react-hot-toast` (if using React) or a simple custom notification component to show these messages as non-modal popups.

## Code Example (Polling for Status)
```javascript
// ... after getting the signature
setUiLoading("Processing transaction...");

try {
    const result = await connection.confirmTransaction(signature, 'processed');
    
    if (result.value.err) {
        throw new Error('Transaction failed on-chain');
    }

    setUiSuccess("Purchase confirmed! You can now use the skill.");
    // Close the modal and update the UI to show ownership
} catch (error) {
    console.error(error);
    setUiError("Transaction failed. Please try again.");
}
```
