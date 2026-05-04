---
status: not-started
---
# Prompt 14: Frontend UI for Purchase Flow

**Status:** Not Started

## Objective
Provide clear, real-time feedback to the user throughout the entire purchase process.

## Explanation
A user should never be left wondering what's happening, especially when money is involved. This task is about updating the UI to reflect the state of the purchase: preparing, waiting for signature, sending, confirming, and success or failure.

## Instructions
1.  **Refactor the purchase logic from the previous tasks.**
2.  **When the "Purchase" button is clicked:**
    - Immediately disable the button and show a loading spinner or "Preparing..." text.
3.  **When waiting for the user to sign in their wallet:**
    - Update the status message to "Please approve the transaction in your wallet...".
4.  **After the transaction is signed and being sent:**
    - Change the message to "Sending transaction...".
5.  **While confirming the transaction on the blockchain:**
    - Update to "Confirming transaction on the blockchain...".
6.  **Upon success:**
    - Show a success message (e.g., "Purchase Complete!").
    - Replace the "Purchase" button with an "Owned" badge.
7.  **On any failure (user rejects, network error, etc.):**
    - Show a descriptive error message.
    - Re-enable the "Purchase" button so the user can try again.

## Code Example (UI state management)
```javascript
// In the purchase button click handler
const purchaseButton = event.target;

function setButtonState(btn, text, disabled) {
    btn.textContent = text;
    btn.disabled = disabled;
}

try {
    setButtonState(purchaseButton, 'Preparing...', true);
    const { transaction } = await fetchFromApi(...);

    setButtonState(purchaseButton, 'Approve in wallet...', true);
    const signature = await signAndSend(transaction); // This function internally would update state too

    setButtonState(purchaseButton, 'Confirming...', true);
    await fulfillOnBackend(signature);

    // Replace button with "Owned" badge
    purchaseButton.outerHTML = `<span class="price-badge price-owned">Owned</span>`;

} catch (error) {
    alert(`Failed: ${error.message}`);
    setButtonState(purchaseButton, 'Purchase', false); // Reset on failure
}
```
