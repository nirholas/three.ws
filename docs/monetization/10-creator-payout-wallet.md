# Prompt 10: Creator Payouts Wallet

## Objective
Add a field in the user's settings or profile page for creators to specify the Solana wallet address where they want to receive payments for their paid skills.

## Explanation
To pay creators, we need to know where to send the funds. This task involves adding a UI element and the corresponding backend logic to allow users to save their primary payout wallet address. This address will be used as the destination for all skill purchase transactions.

## Instructions
1.  **Database Schema Update:**
    *   Add a new nullable column to your `users` table, such as `payout_wallet_address` (of type `VARCHAR(255)`).

2.  **Update the User Settings UI:**
    *   In the user's profile or dashboard page (e.g., `profile.html`), add a new section for "Payout Information".
    *   Include an `<input type="text">` field for the user to enter their Solana wallet address.
    *   Add a "Save" button for this section.

3.  **Frontend Logic:**
    *   When the page loads, fetch the current user's data and populate the input field with their saved `payout_wallet_address`, if it exists.
    *   When the "Save" button is clicked:
        *   Perform basic client-side validation to check if the input looks like a valid Solana address (e.g., check length, base58 characters).
        *   Make a `PUT` or `POST` request to a new backend endpoint to save the address.

4.  **Backend Endpoint:**
    *   Create an endpoint, e.g., `/api/users/me/payout-wallet`.
    *   This endpoint should be authenticated.
    *   It will receive the wallet address in the request body.
    *   Perform server-side validation to ensure it's a valid public key.
    *   Update the `payout_wallet_address` column for the authenticated user in the `users` table.

## HTML Example (`profile.html`)

```html
<div class="settings-section">
    <h2>Payout Wallet</h2>
    <p>Enter the Solana wallet address where you'd like to receive payments.</p>
    <div class="form-group">
        <label for="payout-wallet">Solana Wallet Address</label>
        <input type="text" id="payout-wallet" placeholder="Enter your public key">
        <small id="wallet-error" class="error-text"></small>
    </div>
    <button id="save-payout-wallet-btn">Save Wallet Address</button>
</div>
```

## Frontend JavaScript Example

```javascript
import { PublicKey } from '@solana/web3.js';

const saveBtn = document.getElementById('save-payout-wallet-btn');
const walletInput = document.getElementById('payout-wallet');
const errorEl = document.getElementById('wallet-error');

saveBtn.addEventListener('click', async () => {
    const address = walletInput.value.trim();
    errorEl.textContent = '';

    // Client-side validation
    try {
        new PublicKey(address); // Throws an error if invalid
    } catch (e) {
        errorEl.textContent = 'Invalid Solana address.';
        return;
    }

    // Send to backend
    const response = await fetch('/api/users/me/payout-wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: address }),
    });

    if (response.ok) {
        showToast('Payout wallet updated!', 'success');
    } else {
        showToast('Failed to update wallet.', 'error');
    }
});
```
