# Prompt 7: Real-time UI Update on Purchase

## Objective
Update the agent detail page UI in real-time to reflect a successful skill purchase without requiring a page refresh.

## Explanation
A seamless user experience requires immediate feedback. After a user approves the transaction on their phone, the webpage should detect the successful purchase and automatically update the UI. It should change the "Purchase" button to an "Owned" status indicator. We can achieve this by having the frontend poll a confirmation endpoint while the payment modal is open.

## Instructions
1.  **Create a Polling Endpoint (Backend):**
    *   Create a new, simple endpoint, e.g., `/api/payments/check-purchase-status`.
    *   This endpoint will take a transaction `reference` ID as a query parameter.
    *   It will check the `user_skill_ownership` table to see if the record for that purchase exists.
    *   It should return a status, e.g., `{ status: 'confirmed' }` or `{ status: 'pending' }`.

2.  **Implement Polling (Frontend - `src/marketplace.js`):**
    *   When you first make the `POST` request to prepare the transaction, the response should include the unique `reference` ID.
    *   Once the QR code is displayed, start a polling mechanism (e.g., using `setInterval`).
    *   Every 2-3 seconds, make a `GET` request to `/api/payments/check-purchase-status?reference=<reference_id>`.
    *   If the status comes back as `confirmed`:
        *   Stop the polling (`clearInterval`).
        *   Close the payment modal.
        *   Re-render the skills section or dynamically update the specific skill entry in the DOM to show the "Owned" state.
        *   Show a success notification (toast).
    *   The polling should also have a timeout (e.g., 5 minutes) to prevent it from running forever if something goes wrong.

## Code Example (Frontend - `src/marketplace.js`)

```javascript
// Inside handlePurchaseClick, after the POST request succeeds
const { transaction, message, reference } = await response.json(); // Backend must return reference

const url = `solana:${encodeURIComponent(transaction)}`;
renderPaymentModal(url, message);

// Start polling for confirmation
const pollInterval = setInterval(async () => {
    try {
        const statusRes = await fetch(`/api/payments/check-purchase-status?reference=${reference}`);
        const { status } = await statusRes.json();

        if (status === 'confirmed') {
            clearInterval(pollInterval);
            $('payment-modal').close();
            showToast('Purchase successful!', 'success');

            // Find the button and replace it with an 'Owned' span
            const button = document.querySelector(`.purchase-skill-btn[data-skill-name="${skillName}"]`);
            if (button) {
                const ownedSpan = document.createElement('span');
                ownedSpan.className = 'skill-owned';
                ownedSpan.textContent = '✓ Owned';
                button.replaceWith(ownedSpan);
            }
        }
    } catch (err) {
        // Silently ignore polling errors, or stop polling after too many failures
        console.warn('Polling error:', err);
    }
}, 2500);

// Add a timeout to stop polling after 5 minutes
setTimeout(() => {
    clearInterval(pollInterval);
}, 300000);
```

## Backend Status Endpoint (`api/payments/check-purchase-status.js`)

```javascript
import { findOwnershipByReference } from '../_lib/db'; // Placeholder DB function

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).end();
    
    const { reference } = req.query;
    if (!reference) return res.status(400).json({ error: 'Reference required' });

    // This DB function needs to link the reference to the ownership record
    const isOwned = await findOwnershipByReference(reference);

    if (isOwned) {
        return res.status(200).json({ status: 'confirmed' });
    } else {
        return res.status(200).json({ status: 'pending' });
    }
}
```
