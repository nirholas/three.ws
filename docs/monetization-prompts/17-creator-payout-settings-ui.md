---
status: not-started
---

# Prompt 17: Creator Payout Settings - UI

## Objective
Create a user interface in the user's settings or profile page for them to manage their payout wallet address.

## Explanation
To receive payments, creators need a secure and simple way to input and update their Solana wallet address. This UI should provide clear instructions and validation.

## Instructions
- [ ] **Design the UI:**
    - [ ] Choose a suitable location for this setting, such as a "Payouts" or "Monetization" tab in the user's main profile/settings page.
    - [ ] Add a new section titled "Payout Wallet".
    - [ ] Include an input field for the Solana wallet address.
    - [ ] Add a "Save" button.
    - [ ] Display the currently saved address (if any) and provide clear helper text, e.g., "This is the Solana wallet where you will receive payments for skill purchases."
    - [ ] Add a warning about the importance of using the correct address.

- [ ] **Implement Frontend Logic:**
    - [ ] When the page loads, fetch the user's current settings, including their `payout_wallet_address`, and populate the input field.
    - [ ] When the user clicks "Save":
        - [ ] Get the value from the input field.
        - [ ] Perform client-side validation to check if it looks like a valid Solana address (e.g., check length and characters). A full validation on the backend is still required.
        - [ ] Make a `PUT` request to the backend endpoint (`/api/users/payout-settings`) with the new address.
        - [ ] Display a success or error message to the user based on the API response.

## HTML Example (in a user settings page)

```html
<div class="settings-section">
  <h3>Payout Wallet</h3>
  <p class="helper-text">Enter the Solana wallet address where you want to receive payments.</p>
  
  <div class="form-group">
    <label for="payout-wallet">Solana Wallet Address</label>
    <input type="text" id="payout-wallet" placeholder="Enter your Solana public key">
    <small>Warning: Ensure this address is correct. Payments sent to a wrong address cannot be recovered.</small>
  </div>
  
  <button id="save-payout-btn">Save Wallet Address</button>
  <div id="payout-status-message"></div>
</div>
```

## JavaScript Example (on Save button click)

```javascript
document.getElementById('save-payout-btn').addEventListener('click', async () => {
    const walletAddress = document.getElementById('payout-wallet').value;
    const statusEl = document.getElementById('payout-status-message');

    // Basic client-side check
    if (walletAddress.length < 32 || walletAddress.length > 44) {
        statusEl.textContent = 'Please enter a valid Solana address.';
        statusEl.style.color = 'red';
        return;
    }
    
    try {
        const response = await fetch('/api/users/payout-settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ payout_wallet_address: walletAddress }),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message);
        }

        statusEl.textContent = 'Payout address updated successfully!';
        statusEl.style.color = 'green';
    } catch (error) {
        statusEl.textContent = `Error: ${error.message}`;
        statusEl.style.color = 'red';
    }
});
```
