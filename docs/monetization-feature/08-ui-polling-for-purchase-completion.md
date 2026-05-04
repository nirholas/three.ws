---
status: not-started
---

# Prompt 8: UI - Polling for Purchase Completion

**Status:** Not Started

## Objective
Implement frontend logic to poll the backend for purchase verification and update the UI upon successful purchase.

## Explanation
After the user is shown the Solana Pay QR code, the frontend needs to know when the transaction is complete. The standard way to do this with Solana Pay is to poll an endpoint on our backend. This task involves writing the JavaScript to repeatedly check for purchase completion and then update the UI in real-time without requiring the user to refresh the page.

## Instructions
1.  **Start polling after QR code is shown:**
    - In `src/marketplace.js`, in the function that shows the Solana Pay modal (`showSolanaPayModal`), you will need the `reference` public key that you generated on the backend. This should be returned from the `/api/skills/purchase` endpoint.
    - Use the Solana Pay `findTransactionSignature` method to listen for the transaction on-chain. This will give you the transaction signature once it's found.

2.  **Poll the verification endpoint:**
    - Once `findTransactionSignature` returns a signature, start polling your `/api/skills/verify-purchase` endpoint.
    - Use a `setInterval` or a recursive `setTimeout` function to make a `POST` request every few seconds (e.g., every 2-3 seconds).
    - Send the transaction signature to the endpoint.

3.  **Handle the polling response:**
    - If the backend responds with success:
        - Stop the polling.
        - Close the payment modal.
        - Update the UI to reflect that the skill is now owned. You can do this by re-rendering the skills section or by directly manipulating the DOM to change the "Buy" button to an "Owned" badge.
    - If the backend responds with an error (e.g., transaction not found yet), continue polling.
    - Implement a timeout for the polling (e.g., 5 minutes) to avoid indefinite requests. If it times out, inform the user that the transaction is taking longer than expected.

## Code Example (`src/marketplace.js`)

```javascript
// In your showSolanaPayModal function or similar

async function pollForPurchaseCompletion(reference, agentId, skillName) {
    const connection = new Connection(SOLANA_RPC_URL);
    let signature;

    try {
        signature = await findTransactionSignature(connection, reference, { finality: 'confirmed' });
    } catch (error) {
        // Handle timeout or other errors from findTransactionSignature
        console.error(error);
        alert('Transaction not found. Please check your wallet.');
        return;
    }

    const pollInterval = setInterval(async () => {
        try {
            const response = await fetch('/api/skills/verify-purchase', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ transactionSignature: signature, agentId, skillName }),
            });

            if (response.ok) {
                clearInterval(pollInterval);
                closeSolanaPayModal(); // Assume this function exists
                // Re-render agent details or update the specific skill entry
                updateSkillAsOwned(skillName); 
            }
        } catch (error) {
            console.error('Polling error:', error);
        }
    }, 3000);

    // Add a timeout to stop polling after, e.g., 5 minutes
    setTimeout(() => {
        clearInterval(pollInterval);
    }, 300000);
}
```

## Verification
- Go through the full purchase flow in your browser.
- After scanning the QR code and approving the transaction, watch the browser's network tab to see the polling requests.
- Verify that once the transaction is confirmed on-chain, the polling stops.
- Confirm that the UI updates automatically to show the skill as "Owned," and the "Buy" button is removed.
- Test the timeout logic by generating a QR code but not completing the transaction.
