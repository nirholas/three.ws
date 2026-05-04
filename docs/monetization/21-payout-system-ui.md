# Prompt 21: Payout System UI

## Objective
Create the user interface in the creator dashboard that allows creators to see their withdrawable balance and initiate a payout.

## Explanation
This is the frontend component of the payout system. It should clearly display how much money the creator can withdraw and provide a simple button to start the process. It also needs a way for creators to set the Solana wallet address where they want to receive their funds.

## Instructions
1.  **File to Edit:**
    *   Open `agent-edit.html` and focus on the `#panel-earnings` section created in a previous prompt.

2.  **Create Payouts UI Section:**
    *   Within the "Payout Settings" area of the earnings panel, add the following elements:
        *   An input field for the user to enter their Solana payout wallet address.
        *   A "Save Address" button.
        *   A display area to show the currently saved wallet address.
        *   A display for the "Withdrawable Balance". This should be the same value shown in the summary card at the top of the page.
        *   A "Withdraw Funds" button. This button should be disabled if the withdrawable balance is zero.

3.  **Implement JavaScript Logic:**
    *   **Saving Wallet Address:**
        *   When "Save Address" is clicked, validate that the input contains a plausible Solana address (e.g., check length and characters).
        *   Make a `POST` request to a new backend endpoint (e.g., `/api/dashboard/payout-settings`) to save the user's payout address.
    *   **Initiating Withdrawal:**
        *   When "Withdraw Funds" is clicked:
            *   Show a confirmation dialog (`confirm()`) to prevent accidental withdrawals.
            *   If confirmed, make a `POST` request to a new backend endpoint (e.g., `/api/dashboard/request-payout`).
            *   The button should be disabled and show a "Processing..." state while waiting for the API response.
            *   On success, show a confirmation message to the user (e.g., "Payout initiated! It may take a few minutes to arrive.").
            *   On failure, show an error message.

## Code Example (Frontend - `agent-edit.html` HTML)

```html
<!-- Inside the #earnings-payouts div -->
<h4>Payout Wallet</h4>
<div class="form-group">
    <label class="form-label">Your Solana Wallet Address</label>
    <div class="payout-address-row">
        <input class="form-input" id="payout-wallet-input" type="text" placeholder="Enter your SOL address...">
        <button class="btn-secondary" id="save-wallet-btn">Save</button>
    </div>
    <div class="form-status" id="payout-wallet-status"></div>
</div>

<hr class="earnings-divider">

<h4>Withdraw</h4>
<div class="payout-withdraw-row">
    <div>
        <span class="label">Withdrawable Balance</span>
        <span class="value" id="payout-withdrawable-balance">$0.00</span>
    </div>
    <button class="btn-primary" id="withdraw-btn" disabled>Withdraw Funds</button>
</div>
<div class="form-status" id="withdraw-status"></div>

```

## Code Example (Frontend - `agent-edit.html` JavaScript)

```javascript
// Add this logic to your earnings tab initialization

// Load and display current settings
function loadPayoutSettings(settings) {
    const input = document.getElementById('payout-wallet-input');
    if (settings.payout_address) {
        input.value = settings.payout_address;
    }
    document.getElementById('payout-withdrawable-balance').textContent = formatCurrency(summary.withdrawable);
    document.getElementById('withdraw-btn').disabled = summary.withdrawable <= 0;
}

// Save wallet button
document.getElementById('save-wallet-btn').addEventListener('click', async () => {
    const address = document.getElementById('payout-wallet-input').value.trim();
    // Add basic validation here
    
    // API call to save address
    const res = await fetch('/api/dashboard/payout-settings', { /* ... */ });
    // ... handle response and status message
});

// Withdraw button
document.getElementById('withdraw-btn').addEventListener('click', async () => {
    if (!confirm('Are you sure you want to withdraw your available balance?')) return;

    const btn = document.getElementById('withdraw-btn');
    const statusEl = document.getElementById('withdraw-status');
    btn.disabled = true;
    statusEl.textContent = 'Processing...';

    // API call to request payout
    const res = await fetch('/api/dashboard/request-payout', { method: 'POST' });
    if (res.ok) {
        statusEl.textContent = 'Payout initiated!';
        // Refresh earnings data to show updated balance
        initEarningsTab(); 
    } else {
        const { error } = await res.json();
        statusEl.textContent = `Error: ${error}`;
        btn.disabled = false;
    }
});
```
