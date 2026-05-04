# Prompt 09: Frontend Polling for Purchase Confirmation

## Objective
After displaying the Solana Pay QR code, implement a client-side polling mechanism to check the status of the purchase and update the UI upon confirmation.

## Explanation
While the webhook provides server-to-server confirmation, the user on the frontend is waiting for feedback. We need to poll a backend endpoint to check the status of the `user_skill_purchases` record. Once the status changes from 'pending' to 'confirmed', we can close the purchase modal and show a success message.

## Instructions
1.  **Create a Status Check API Endpoint:**
    *   Create a new API endpoint, e.g., `api/marketplace/purchase-status.js`.
    *   It should accept a `purchaseId` as a query parameter.
    *   The endpoint will query the `user_skill_purchases` table for the given ID.
    *   It should return the current `status` of the purchase record.
    *   **Security:** Ensure the user making the request is the same user who initiated the purchase.

2.  **Implement Frontend Polling:**
    *   In `src/marketplace.js`, within the `showPurchaseModal` function (from Prompt 06), start a polling loop after displaying the QR code.
    *   Use `setInterval` to call the `/api/marketplace/purchase-status?purchaseId=...` endpoint every few seconds (e.g., 2-3 seconds).
    *   **On Confirmation:** If the endpoint returns `{ status: 'confirmed' }`, clear the interval, hide the modal, and display a success message to the user.
    *   **On Failure:** If it returns `{ status: 'failed' }`, inform the user the payment failed.
    *   **Timeout:** Implement a timeout (e.g., 5 minutes) to stop polling if no confirmation is received.

## Code Example (`src/marketplace.js`)

```javascript
// In showPurchaseModal function, after showing the modal...

const purchaseId = txDetails.purchaseId;
const pollingId = setInterval(async () => {
    try {
        const res = await fetch(`/api/marketplace/purchase-status?purchaseId=${purchaseId}`);
        if (!res.ok) return; // Continue polling on server error
        
        const { status } = await res.json();

        if (status === 'confirmed') {
            clearInterval(pollingId);
            $('purchase-modal').hidden = true;
            // TODO: Show success message
            // TODO: Update UI to show the skill as 'Owned'
        } else if (status === 'failed') {
            clearInterval(pollingId);
            // TODO: Show failure message
        }
    } catch (e) {
        console.error('Polling failed', e);
    }
}, 2500);

// Set a timeout to stop polling after 5 minutes
setTimeout(() => {
    clearInterval(pollingId);
}, 300000);
```
