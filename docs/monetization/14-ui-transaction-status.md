---
status: not-started
---

# Prompt 14: UI for Transaction Status

## Objective
Provide real-time feedback to the user about the status of their purchase transaction.

## Explanation
Blockchain transactions are not instant. To provide a good user experience, the UI should show the user that their transaction is being processed and notify them when it's complete.

## Instructions
1.  **Update the Payment Modal:**
    *   After a transaction is sent, update the payment modal to show a "Processing..." state.
    *   Disable the purchase button to prevent multiple submissions.

2.  **Display Confirmation:**
    *   Once the transaction is confirmed, show a success message in the modal.
    *   Include a link to the transaction on a block explorer like Solscan.

3.  **Handle Errors:**
    *   If the transaction fails, display a clear error message and allow the user to try again.
