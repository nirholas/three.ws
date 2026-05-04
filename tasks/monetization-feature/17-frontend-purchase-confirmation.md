---
status: not-started
---

# Prompt 17: Frontend Purchase Confirmation

**Status:** Not Started

## Objective
Implement client-side logic to detect when a purchase is complete and provide feedback to the user.

## Explanation
After the user approves the transaction in their wallet, the frontend needs to know when the transaction is confirmed on the blockchain so it can close the purchase modal and update the UI. This is typically done by polling the backend or using a WebSocket.

## Instructions
- [ ] **Start Polling after Displaying QR Code:**
    - [ ] Once the purchase modal is shown, start a polling mechanism (e.g., using `setInterval`).
    - [ ] The polling function will make a request to a new backend endpoint (e.g., `GET /api/payments/check-status?reference=...`), passing the unique `reference` public key that was part of the Solana Pay request.
- [ ] **Backend Status Check Endpoint:**
    - [ ] Create the `/api/payments/check-status` endpoint.
    - [ ] It will take a `reference` public key as a query parameter.
    - [ ] It should use the Solana `getSignaturesForAddress` RPC method to see if that reference key has been used in a recent transaction.
    - [ ] If a signature is found, the purchase is likely complete. The endpoint can then do the full confirmation (like in Prompt 6) and record the purchase. It should return `{ status: 'confirmed' }`.
    - [ ] If no signature is found, it should return `{ status: 'pending' }`.
- [ ] **Handle Confirmation on Frontend:**
    - [ ] When the polling function receives a `'confirmed'` status:
        - Stop the polling (`clearInterval`).
        - Show a success message in the modal.
        - Close the modal after a short delay.
        - Trigger a UI update to change the "Buy" button to "Owned".

## Code Example (Frontend Polling)

```javascript
// After showing the QR code in the modal...

const reference = new URL(solanaPayUrl).searchParams.get('reference');
const pollInterval = setInterval(async () => {
    try {
        const res = await fetch(`/api/payments/check-status?reference=${reference}`);
        const { status } = await res.json();

        if (status === 'confirmed') {
            clearInterval(pollInterval);
            // Show success animation/message
            showSuccessAndCloseModal();
            // Refresh user's skills to update the UI
            fetchUserSkillsAndUpdateUI();
        }
    } catch (err) {
        // Handle errors, maybe stop polling after too many failures
    }
}, 2000); // Poll every 2 seconds
```
