# Prompt 21: Payout Wallet UI

## Objective
Create the user interface in the Revenue Dashboard for creators to view, add, and edit their Solana payout wallet address.

## Explanation
This is the frontend counterpart to the Payout Wallet API. We need to provide a simple form where a creator can input their Solana address. The UI should fetch the current address on load and allow them to save a new one.

## Instructions
1.  **Locate the Frontend Dashboard Code:**
    *   Open `public/dashboard/dashboard.js`.

2.  **Add UI Placeholder:**
    *   In the `renderRevenue` function, add a new panel or section for "Payout Settings" below the stats grid. This section will contain the form.

3.  **Create a New Function to Manage the UI:**
    *   Create an `async` function `initPayoutSettings()`. Call this from `renderRevenue`.
    *   Inside `initPayoutSettings`, first `fetch` the current wallet settings from your `GET /api/billing/payout-wallet` endpoint.
    *   Render the form. The input field should be pre-filled with the address if it exists.
    *   The "Save" button should be accompanied by a "Remove" button if a wallet is already configured.

4.  **Implement Save Logic:**
    *   Add a `click` listener to the "Save" button.
    *   On click, get the value from the input field.
    *   Perform a basic client-side validation (e.g., check if it's not empty).
    *   Make a `POST` request to `/api/billing/payout-wallet` with the new address.
    *   Show a "Saving..." state, and then "Saved" or an error message based on the API response.

5.  **Implement Remove Logic:**
    *   Add a `click` listener to the "Remove" button.
    *   On click, show a confirmation dialog (`if (confirm(...))`).
    *   If confirmed, make a `DELETE` request to `/api/billing/payout-wallet`.
    *   On success, clear the input field and remove the "Remove" button.

## Code Example (Frontend - `public/dashboard/dashboard.js`)

```javascript
// In renderRevenue, add the placeholder and call the init function
async function renderRevenue(root) {
    // ... code to render stats ...
    root.innerHTML += `
        <div class="panel">
            <div class="panel-header"><h2>Payout Settings</h2></div>
            <div class="panel-body" id="payout-settings-container">
                Loading settings...
            </div>
        </div>
    `;
    initPayoutSettings();
}

// Add the new function to manage this section
async function initPayoutSettings() {
    const container = document.getElementById('payout-settings-container');
    try {
        const res = await fetch('/api/billing/payout-wallet', { credentials: 'include' });
        const { wallet } = await res.json();
        renderPayoutForm(wallet);
    } catch (e) {
        container.innerHTML = `<div class="err">Failed to load payout settings.</div>`;
    }
}

function renderPayoutForm(wallet) {
    const container = document.getElementById('payout-settings-container');
    container.innerHTML = `
        <div class="form-group">
            <label for="payout-address">Solana Payout Wallet</label>
            <input type="text" id="payout-address" class="form-input" placeholder="Enter your Solana wallet address" value="${wallet ? esc(wallet.address) : ''}">
            <p class="subtle">This is where your earnings will be sent.</p>
        </div>
        <div class="form-actions">
            <button class="btn btn-primary" id="save-payout-btn">Save</button>
            ${wallet ? '<button class="btn btn-danger" id="remove-payout-btn">Remove</button>' : ''}
            <span class="form-status" id="payout-status"></span>
        </div>
    `;

    document.getElementById('save-payout-btn').addEventListener('click', savePayoutWallet);
    if (wallet) {
        document.getElementById('remove-payout-btn').addEventListener('click', removePayoutWallet);
    }
}

async function savePayoutWallet() {
    const status = document.getElementById('payout-status');
    const address = document.getElementById('payout-address').value.trim();
    if (!address) {
        status.textContent = 'Address cannot be empty.';
        return;
    }
    
    status.textContent = 'Saving...';
    try {
        const res = await fetch('/api/billing/payout-wallet', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address, chain: 'solana' }),
        });
        const { wallet } = await res.json();
        if (!res.ok) throw new Error('Failed to save.');
        
        status.textContent = 'Saved!';
        renderPayoutForm(wallet); // Re-render to add remove button if it's new
    } catch (e) {
        status.textContent = `Error: ${e.message}`;
    }
}

async function removePayoutWallet() {
    if (!confirm('Are you sure you want to remove your payout wallet?')) return;
    
    const status = document.getElementById('payout-status');
    status.textContent = 'Removing...';
    try {
        await fetch('/api/billing/payout-wallet', { method: 'DELETE', credentials: 'include' });
        status.textContent = 'Removed.';
        renderPayoutForm(null); // Re-render in empty state
    } catch (e) {
        status.textContent = `Error: ${e.message}`;
    }
}
```
