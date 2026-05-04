---
status: not-started
last_updated: 2026-05-04
---
# Prompt 14: Handling Transaction Failures Gracefully

## Objective
Improve the frontend purchase flow to provide clear feedback to the user when a transaction fails for any reason.

## Explanation
On-chain transactions can fail for many reasons: insufficient funds, user rejection, network congestion, or a dropped connection. Our UI must handle these scenarios gracefully instead of leaving the user in a stuck or confusing state.

## Instructions
1.  **Review the Purchase Flow:**
    *   In `src/marketplace.js`, locate the `handlePurchase` function.
    *   It should already have a `try...catch` block. We will make the error handling more specific and user-friendly.

2.  **Implement Granular Error Handling:**
    *   **User Rejection:** The `wallet.signTransaction` call will throw a specific error if the user clicks "Reject" in their wallet. Catch this error and display a message like "Purchase cancelled."
    *   **Insufficient Funds:** While hard to detect pre-emptively without extra calls, RPC errors from `sendRawTransaction` often contain clues. If an error occurs during sending or confirmation, provide a generic but helpful message: "Transaction failed. This could be due to insufficient SOL for gas fees or network issues. Please check your wallet and try again."
    *   **Timeout:** The `connection.confirmTransaction` can time out. Handle this by informing the user: "Transaction confirmation timed out. It may still succeed. Please check your wallet history or a block explorer."
    *   **Backend Errors:** Any failure from our own `prep` or `confirm` APIs should be caught and displayed cleanly.

3.  **Update UI State:**
    *   Ensure that no matter what error occurs, the "Purchase" button is re-enabled and reset to its original state (e.g., "Purchase for X USDC"), allowing the user to retry.
    *   Display the error message in a small, non-intrusive element near the button or as a temporary notification toast.

## Code Example (`src/marketplace.js` - enhanced `catch` block)

```javascript
// ... inside handlePurchase function
} catch (err) {
    console.error('Purchase failed:', err);

    let userMessage = 'An unknown error occurred. Please try again.';

    // Check for specific wallet error codes for user rejection
    if (err.name === 'WalletSignTransactionError' || err.code === 4001) {
        userMessage = 'Purchase cancelled in wallet.';
    } else if (err.message.includes('failed to send')) {
        userMessage = 'Broadcast failed. Check your connection and wallet balance.';
    } else if (err.message.includes('Timed out')) {
        userMessage = 'Confirmation timed out. Please check a block explorer for status.';
    } else if (err.message.includes('Failed to prepare') || err.message.includes('Failed to confirm')) {
        userMessage = 'A server error occurred. Please try again later.';
    }

    // Display the message to the user (e.g., in a status element)
    const statusEl = document.getElementById('purchase-status-indicator'); // Assume this exists
    if (statusEl) {
        statusEl.textContent = userMessage;
        statusEl.style.color = 'var(--err)';
    }

    // Reset the button
    button.disabled = false;
    // You might need to retrieve the price again to format this text correctly
    button.textContent = 'Retry Purchase';
}
```
