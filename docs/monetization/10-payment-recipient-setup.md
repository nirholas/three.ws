# Prompt 10: Creator Payment Address Setup

## Objective
Allow agent creators to specify their own Solana wallet address as the recipient for skill payments.

## Explanation
To make the platform a true marketplace, creators need to be able to receive payments directly. This involves adding a field in the agent creation/editing form for a payout address and storing it securely in the backend.

## Instructions
1.  **Update Database Schema:**
    *   Add a `creator_wallet_address` column to the `agents` table in your database. This will store the public key of the creator's wallet.

2.  **Modify Agent Edit UI:**
    *   In the UI where creators can create or edit their agents (`agent-edit.html`), add a new input field for "Payout Wallet Address."
    *   Implement frontend validation to ensure the entered string is a valid Solana public key format.

3.  **Update Backend API:**
    *   Modify the agent update endpoint (e.g., `/api/agents/:id` with a `POST` or `PUT` method).
    *   When an agent is updated, validate the provided `creator_wallet_address` on the backend as well.
    *   Save the validated address to the new column in the `agents` table.

4.  **Use the Address in Transactions:**
    *   In `prompt-05-initiate-solana-transaction`, the code already assumes the agent object contains `creator_wallet_address`. This prompt ensures that data is actually captured and saved correctly. No changes are needed to the transaction logic itself, as it was designed to be dynamic.

## Code Example (Frontend Validation in `agent-edit.js`)
```javascript
import { PublicKey } from '@solana/web3.js';

const walletInput = document.getElementById('payout-wallet-input');
const saveButton = document.getElementById('save-agent-button');

walletInput.addEventListener('input', () => {
    try {
        // Validate the public key format
        new PublicKey(walletInput.value);
        walletInput.setCustomValidity(''); // Valid
    } catch (error) {
        walletInput.setCustomValidity('Please enter a valid Solana wallet address.'); // Invalid
    }
});

saveButton.addEventListener('click', async () => {
    // On save, re-validate before sending to backend
    if (!walletInput.reportValidity()) {
        return; // Don't submit if invalid
    }
    //... proceed with fetch to backend API
});
```
