# Prompt 7: Update UI with Purchase Status (Loading, Success, Error)

**Status:** - [ ] Not Started

## Objective
Provide real-time feedback to the user during and after the purchase process by updating the UI to show loading, success, and error states.

## Explanation
A good user experience requires clear communication about the status of an action. After a user confirms a purchase, they should see a loading indicator. Once the transaction is processed and verified, the UI should update to show either a success message and reflect the new ownership status, or an error message if something went wrong.

## Instructions
1.  **Add Loading State:**
    *   In `src/marketplace.js`, when the "Confirm Purchase" button is clicked, disable the button and show a loading indicator within the modal.

2.  **Handle Success State:**
    *   After the backend verification endpoint returns a success response:
        *   Close the purchase modal.
        *   Re-render the skills list for the agent, or dynamically update the specific skill entry that was just purchased. It should now show the "Owned" badge instead of the "Purchase" button.
        *   Show a success toast message (e.g., "Purchase successful!").

3.  **Handle Error State:**
    *   If the Solana transaction fails on the client-side, or if the backend verification endpoint returns an error:
        *   Display a clear error message to the user, either in the modal or as a toast.
        *   Re-enable the "Confirm Purchase" button so the user can try again.

## Code Example (JavaScript in `src/marketplace.js`)

```javascript
// Inside the 'click' event listener for modal-confirm-purchase-btn
const confirmBtn = $('modal-confirm-purchase-btn');

confirmBtn.disabled = true;
confirmBtn.textContent = 'Processing...';

try {
  // 1. Send Solana Transaction
  const signature = await wallet.sendTransaction(transaction, connection);
  await connection.confirmTransaction(signature, 'processed');

  // 2. Call Backend for Verification
  const response = await fetch('/api/marketplace/purchase-skill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId, skillName, transactionSignature: signature }),
  });

  if (!response.ok) {
    throw new Error('Backend verification failed.');
  }

  // 3. Handle Success
  showToast('Purchase successful!', 'success');
  purchaseModal.style.display = 'none';
  // You would need to re-fetch the user's skills and re-render the detail view
  // to show the 'Owned' status.
  // For simplicity, we can just reload the agent details.
  const agentId = window.currentAgent.id;
  loadAgentDetail(agentId); 

} catch (error) {
  // 4. Handle Error
  console.error('Purchase failed:', error);
  showToast(`Purchase failed: ${error.message}`, 'error');
  confirmBtn.disabled = false;
  confirmBtn.textContent = 'Confirm Purchase';
}

// A simple toast function
function showToast(message, type = 'info') {
  // Implementation of a toast notification system
}
```
