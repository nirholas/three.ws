---
status: not-started
---

# Prompt 22: Frontend Payment Error Handling

**Status:** Not Started

## Objective
Improve the user experience by providing clear feedback in the purchase modal when a payment fails or times out.

## Explanation
Things can go wrong during the payment process. The user might close the modal, their transaction might fail on-chain, or our backend confirmation might time out. The UI needs to handle these cases gracefully instead of leaving the user in a loading state.

## Instructions
- [ ] **Implement a Timeout:**
    - [ ] In the polling logic from Prompt 17, add a timeout mechanism. For example, if the purchase is not confirmed after 2 minutes, stop polling.
- [ ] **Handle API Errors:**
    - [ ] Wrap all `fetch` calls in the purchase flow in `try...catch` blocks.
    - [ ] If an API call fails (e.g., to create the transaction or check the status), display a clear error message in the modal.
- [ ] **Display Specific Messages:**
    - [ ] Provide different messages for different states:
        - "Transaction timed out. Please check your wallet and try again."
        - "Could not create transaction. Please refresh the page."
        - "Payment failed. The transaction was not successful on the network."
- [ ] **Add a "Try Again" Button:**
    - [ ] When an error occurs, it's helpful to show a "Try Again" button that restarts the purchase process for that skill.

## Code Example (Frontend Polling with Timeout)

```javascript
const reference = new URL(solanaPayUrl).searchParams.get('reference');
let pollCount = 0;
const maxPolls = 60; // 2 minutes if polling every 2 seconds

const pollInterval = setInterval(async () => {
    pollCount++;
    if (pollCount > maxPolls) {
        clearInterval(pollInterval);
        showErrorInModal("Transaction timed out. Please check your wallet.");
        return;
    }

    try {
        const res = await fetch(`/api/payments/check-status?reference=${reference}`);
        if (!res.ok) throw new Error('Status check failed');
        const { status } = await res.json();

        if (status === 'confirmed') {
            clearInterval(pollInterval);
            handlePurchaseSuccess(...);
        }
    } catch (err) {
        clearInterval(pollInterval);
        showErrorInModal("An error occurred. Please try again.");
    }
}, 2000);
```
