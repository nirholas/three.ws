---
status: not-started
last_updated: 2026-05-04
---
# Prompt 11: Creator Wallet Management UI

## Objective
Create a settings page where agent creators can specify the Solana wallet address where they want to receive payments for skill purchases.

## Explanation
To receive payments, creators must provide a destination wallet. This needs to be a secure and user-friendly process. We will create a dedicated UI in the user's profile or dashboard area to manage this. The chosen wallet address will be linked to the agent's on-chain identity.

## Instructions
1.  **Design the UI:**
    *   Create a new page or a new section in an existing user settings/dashboard page (e.g., `profile.html`).
    *   The UI should consist of:
        *   An input field for the user to paste their Solana wallet address.
        *   A "Save" button.
        *   A display area showing the currently saved wallet address, if any.
        *   Clear instructions and warnings (e.g., "Use a wallet you control. Payments are irreversible.").

2.  **Connect to Backend:**
    *   The "Save" button will send the wallet address to a new backend endpoint.

3.  **Backend Logic:**
    *   Create an endpoint like `POST /api/users/payout-wallet`.
    *   **Authentication:** The user must be logged in.
    *   **Validation:**
        *   The provided string must be a valid Solana public key. Use a library like `@solana/web3.js`'s `PublicKey` constructor to validate.
    *   **Storage:**
        *   The wallet address should be stored securely. A good place for it is in the `meta` JSONB column of the user's primary `agent_identity` that represents their creator profile, or on the `users` table itself. Let's associate it with their main agent identity.
        *   Specifically, update the agent's `meta.onchain.wallet` field. This aligns with the on-chain identity of the agent.

## Code Example (HTML in `profile.html`)

```html
<div class="panel">
    <h2 class="panel-title">Payout Wallet</h2>
    <p class="panel-subtitle">
        Enter the Solana wallet address where you'd like to receive payments for skill sales.
    </p>
    <div class="field">
        <label for="payout-wallet">Solana Wallet Address</label>
        <input type="text" id="payout-wallet" placeholder="Enter your Solana address">
    </div>
    <button id="save-wallet-btn" class="btn">Save Wallet</button>
    <div id="wallet-save-status"></div>
</div>
```

## Code Example (JavaScript)

```javascript
const saveBtn = document.getElementById('save-wallet-btn');
const walletInput = document.getElementById('payout-wallet');
const statusEl = document.getElementById('wallet-save-status');

// On page load, fetch and display the current wallet
fetch('/api/users/me').then(r => r.json()).then(user => {
    const mainAgent = user.identities?.find(id => id.is_primary);
    if (mainAgent?.meta?.onchain?.wallet) {
        walletInput.value = mainAgent.meta.onchain.wallet;
    }
});

saveBtn.addEventListener('click', async () => {
    const newAddress = walletInput.value.trim();
    saveBtn.disabled = true;
    statusEl.textContent = 'Saving...';

    const resp = await fetch('/api/users/payout-wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet_address: newAddress }),
    });

    if (resp.ok) {
        statusEl.textContent = 'Wallet updated successfully!';
        statusEl.style.color = 'var(--ok)';
    } else {
        const { error_description } = await resp.json();
        statusEl.textContent = `Error: ${error_description}`;
        statusEl.style.color = 'var(--err)';
    }
    saveBtn.disabled = false;
});
```
