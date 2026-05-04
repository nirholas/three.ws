# Prompt 4: Connect Wallet Integration

**Status:** - [ ] Not Started

## Objective
Integrate a "Connect Wallet" feature into the purchase modal, allowing users to connect their Solana wallet before making a purchase.

## Explanation
To purchase skills, users must have a connected Solana wallet. This prompt focuses on adding the necessary UI and logic to handle wallet connection directly within the purchase flow, ensuring a seamless user experience. We will use `@solana/wallet-adapter-react` and related libraries, which might already be in the project.

## Instructions
1.  **Add a Wallet Connection Button:**
    *   In the purchase modal's HTML, add a "Connect Wallet" button. This button should be shown if the user's wallet is not connected, and the "Confirm Purchase" button should be hidden.

2.  **Implement Wallet Connection Logic:**
    *   Use a wallet adapter library (like `@solana/wallet-adapter-react` or equivalent for vanilla JS) to handle the wallet connection logic.
    *   When the "Connect Wallet" button is clicked, trigger the wallet adapter's connection modal.
    *   Once the wallet is connected, update the UI of the purchase modal to hide the "Connect Wallet" button and show the "Confirm Purchase" button.

3.  **Manage Wallet State:**
    *   Maintain a global state that tracks the user's wallet connection status and public key.
    *   The `renderDetail` function and the purchase modal logic should react to changes in this wallet state.

## Code Example (JavaScript in `src/marketplace.js`)

```javascript
// This example assumes a wallet adapter setup that exposes a `wallet` object
// and `connectWallet` function.

// In the event listener for the purchase button
$('d-skills').addEventListener('click', (e) => {
  if (e.target.classList.contains('purchase-btn')) {
    // ... (previous modal logic)

    // New logic to handle wallet connection
    if (wallet.connected) {
      $('modal-connect-wallet-btn').style.display = 'none';
      $('modal-confirm-purchase-btn').style.display = 'block';
    } else {
      $('modal-connect-wallet-btn').style.display = 'block';
      $('modal-confirm-purchase-btn').style.display = 'none';
    }

    purchaseModal.style.display = 'flex';
  }
});

// Event listener for the new connect wallet button
$('modal-connect-wallet-btn').addEventListener('click', async () => {
  try {
    await connectWallet();
    // After successful connection, update the modal UI
    $('modal-connect-wallet-btn').style.display = 'none';
    $('modal-confirm-purchase-btn').style.display = 'block';
  } catch (error) {
    console.error('Failed to connect wallet:', error);
    // Handle connection error (e.g., show a toast message)
  }
});
```

## Code Example (HTML in `marketplace.html`)

```html
<!-- Update the modal footer -->
<div class="modal-footer">
  <button id="modal-connect-wallet-btn" class="purchase-btn" style="display: none;">Connect Wallet</button>
  <button id="modal-confirm-purchase-btn" class="purchase-btn" style="display: none;">Confirm Purchase</button>
</div>
```
