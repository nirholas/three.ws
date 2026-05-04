# Prompt 23: UI for Payout Wallet Configuration

## Objective
Implement the UI and the corresponding backend endpoint for creators to securely save and update their Solana payout wallet address.

## Explanation
Before creators can receive payouts, they must specify where the funds should be sent. This prompt covers creating a simple form for this purpose and the API to persist this setting.

## Instructions
1.  **Database Schema:**
    *   Ensure your `users` table (or a related `user_settings` table) has a column to store the payout address, e.g., `payout_sol_address` (nullable `VARCHAR`).

2.  **File to Edit (Frontend):**
    *   Open `agent-edit.html` and its associated JavaScript. Focus on the "Payout Settings" section of the "Earnings" tab.

3.  **Implement Frontend Logic:**
    *   **Display Current Address:** When the earnings tab loads, the data from `/api/dashboard/earnings` should include the user's currently saved `payout_address`. Display this in or below the input field.
    *   **Save Button Event Listener:**
        *   Attach a `click` event listener to the "Save Address" button (`#save-wallet-btn`).
        *   When clicked, get the value from the input field (`#payout-wallet-input`).
        *   **Validation:** Perform basic client-side validation. A simple check is to ensure the address is between 32 and 44 characters and contains only Base58 characters. For a more robust check, you could use a library.
        *   If valid, make a `POST` request to a new `/api/dashboard/payout-settings` endpoint.
        *   Display status messages (e.g., "Saving...", "Saved!", "Invalid address.") in the status element (`#payout-wallet-status`).

4.  **Create Backend Endpoint (Backend):**
    *   Create the new endpoint: `POST /api/dashboard/payout-settings`.
    *   **Authentication:** Ensure the user is authenticated.
    *   **Validation:**
        *   The request body should contain the `address`.
        *   Perform robust server-side validation to ensure it's a valid Solana public key. You can do this by trying to construct a `new PublicKey(address)` from `@solana/web3.js` inside a try-catch block.
    *   **Database Update:** Update the `payout_sol_address` column for the authenticated user in your `users` (or `user_settings`) table.
    *   Return a success message.

## Code Example (Frontend - `agent-edit.html` script)

```javascript
// In the script for agent-edit.html

const saveWalletBtn = document.getElementById('save-wallet-btn');
const walletInput = document.getElementById('payout-wallet-input');
const walletStatus = document.getElementById('payout-wallet-status');

saveWalletBtn.addEventListener('click', async () => {
  const address = walletInput.value.trim();

  // Basic client-side validation
  if (address.length < 32 || address.length > 44) {
    walletStatus.textContent = 'Invalid address length.';
    return;
  }
  
  walletStatus.textContent = 'Saving...';
  saveWalletBtn.disabled = true;

  try {
    const res = await fetch('/api/dashboard/payout-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: address })
    });

    if (!res.ok) {
      const { error } = await res.json();
      throw new Error(error || 'Failed to save.');
    }

    walletStatus.textContent = 'Saved!';
  } catch (err) {
    walletStatus.textContent = `Error: ${err.message}`;
  } finally {
    saveWalletBtn.disabled = false;
  }
});
```

## Code Example (Backend - `/api/dashboard/payout-settings.js`)

```javascript
import { PublicKey } from '@solana/web3.js';

// --- Inside your API handler ---

const { address } = req.body;
const user = await getAuthenticatedUser(req);

// Server-side validation
try {
  // This will throw an error if the address is not a valid base58 string
  new PublicKey(address); 
} catch (error) {
  return res.status(400).json({ error: 'Invalid Solana address format.' });
}

try {
  // Update the user's record in the database
  await db('users')
    .where({ id: user.id })
    .update({ payout_sol_address: address });

  res.status(200).json({ message: 'Payout address updated.' });
} catch (dbError) {
  res.status(500).json({ error: 'Database error.' });
}
```
