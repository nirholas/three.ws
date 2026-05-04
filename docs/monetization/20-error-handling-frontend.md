# Prompt 20: Error Handling (Frontend)

## Objective
Implement robust and user-friendly error handling throughout the entire frontend purchase flow.

## Explanation
Things can go wrong during a purchase: the backend API might be down, the Solana network could be congested, or the user might close the modal prematurely. We need to catch these errors and provide clear, helpful feedback to the user instead of leaving them with a broken UI.

## Instructions
1.  **Use `try...catch` Blocks:**
    *   Wrap all `fetch` calls and asynchronous operations in your payment logic (`src/marketplace.js`) within `try...catch` blocks.

2.  **Display User-Friendly Messages:**
    *   When an error is caught, display a message to the user. Don't show raw technical errors like "TypeError: failed to fetch".
    *   Use a dedicated element in your payment modal or a global "toast" notification system.
    *   Messages should be actionable. For example:
        *   "Could not connect to the server. Please check your internet connection and try again."
        *   "Failed to create the transaction. Please try again in a few moments."
        *   "The transaction timed out. Please try again."

3.  **Manage UI State:**
    *   Ensure that the UI is correctly reset after an error. For example, if an error occurs while generating the QR code, the loading spinner should be hidden, and the "Purchase" button should become clickable again.
    *   The payment modal should have a "Close" or "Cancel" button that properly cleans up any polling timers or pending states.

## Code Example (Frontend - `src/marketplace.js`)

```javascript
// In your handlePurchaseClick function

const modal = $('payment-modal');
const spinner = modal.querySelector('.spinner');
const errorMessageEl = modal.querySelector('.error-message');
let pollInterval = null; // Keep track of the timer

function showModalError(message) {
    spinner.hidden = true;
    errorMessageEl.textContent = message;
}

function cleanupModal() {
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }
    modal.close();
    spinner.hidden = true;
    errorMessageEl.textContent = '';
}

modal.querySelector('.close-modal-btn').addEventListener('click', cleanupModal);

// ...
try {
    const response = await fetch('/api/payments/prepare-skill-purchase', { /* ... */ });

    if (!response.ok) {
        // Handle specific HTTP errors from the backend
        const errorData = await response.json().catch(() => ({})); // Gracefully handle non-JSON error bodies
        throw new Error(errorData.error || `The server responded with status ${response.status}. Please try again.`);
    }

    // ... (success path with polling)

    pollInterval = setInterval(/* ... */);
    setTimeout(() => {
        if (pollInterval) {
            clearInterval(pollInterval);
            showModalError("Confirmation timed out. Please check your wallet and transaction history.");
        }
    }, 300000);

} catch (error) {
    console.error('Purchase failed:', error);
    showModalError(error.message || 'An unexpected error occurred.');
}
```
