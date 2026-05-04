---
status: not-started
last_updated: 2026-05-04
---
# Prompt 08: Frontend Logic for Signing and Sending Transaction

## Objective
Implement the client-side logic that takes the prepared transaction from the backend, asks the user to sign it with their wallet, and sends it to the Solana network.

## Explanation
This is the core of the on-chain interaction from the user's perspective. The frontend will receive the base64-encoded transaction, deserialize it, prompt the user for a signature via their connected wallet (e.g., Phantom), and then broadcast the signed transaction to the blockchain.

## Instructions
1.  **Integrate with Wallet Adapter:**
    *   Ensure a Solana wallet adapter (like `@solana/wallet-adapter-react` or a vanilla equivalent) is integrated into your frontend to manage wallet connections.

2.  **Handle the "Purchase" Button Click:**
    *   In `src/marketplace.js`, attach an async function to the purchase button's click event.

3.  **Implement the Purchase Flow:**
    *   **Step 1: Fetch Prepared Transaction:**
        *   When the button is clicked, call the `POST /api/skills/purchase-prep` endpoint created in the previous prompt.
    *   **Step 2: Deserialize:**
        *   Take the base64 `transaction` string from the response and deserialize it into a `Transaction` object using the Solana Web3.js library.
    *   **Step 3: Sign Transaction:**
        *   Use the connected wallet's `signTransaction` method to ask the user to sign the transaction. This will pop up the wallet interface. Handle potential user rejection of the signature.
    *   **Step 4: Send Transaction:**
        *   If signing is successful, use the `connection.sendRawTransaction` method to broadcast the signed transaction to the network.
    *   **Step 5: Confirm Transaction:**
        *   Wait for the transaction to be confirmed by the network using `connection.confirmTransaction`. This gives the user feedback that their purchase was successful.
    *   **Step 6: Finalize with Backend:**
        *   After on-chain confirmation, call a new backend endpoint (`/api/skills/purchase-confirm`, to be built next) with the transaction signature. This will record the purchase in our database.

## Code Example (`src/marketplace.js`)

```javascript
import { Connection, Transaction } from '@solana/web3.js';
// Assume `wallet` is the connected wallet object from a wallet adapter
// Assume `connection` is an initialized Connection object

async function handlePurchase(agentId, skillName, button) {
    try {
        // 1. Prepare
        button.disabled = true;
        button.textContent = 'Preparing...';
        const prepRes = await fetch('/api/skills/purchase-prep', {
            method: 'POST',
            body: JSON.stringify({ agent_id: agentId, skill_name: skillName }),
            headers: { 'Content-Type': 'application/json' }
        });
        if (!prepRes.ok) throw new Error('Failed to prepare transaction.');
        const { transaction: base64Tx } = await prepRes.json();

        // 2. Deserialize
        const tx = Transaction.from(Buffer.from(base64Tx, 'base64'));

        // 3. Sign
        button.textContent = 'Please sign...';
        const signedTx = await wallet.signTransaction(tx);

        // 4. Send
        button.textContent = 'Sending...';
        const signature = await connection.sendRawTransaction(signedTx.serialize());

        // 5. Confirm
        button.textContent = 'Confirming...';
        await connection.confirmTransaction(signature, 'confirmed');

        // 6. Finalize with our backend
        const confirmRes = await fetch('/api/skills/purchase-confirm', {
            method: 'POST',
            body: JSON.stringify({ agent_id: agentId, skill_name: skillName, signature }),
            headers: { 'Content-Type': 'application/json' }
        });
        if (!confirmRes.ok) throw new Error('Failed to confirm purchase with server.');

        // 7. Update UI
        button.textContent = '✓ Owned';
        button.classList.add('owned');
        // Prevent further clicks
        button.replaceWith(button.cloneNode(true));

    } catch (err) {
        console.error('Purchase failed:', err);
        button.disabled = false;
        button.textContent = 'Purchase Failed - Retry';
    }
}

// Modify the event listener from Prompt 5
document.getElementById('d-skills').addEventListener('click', (e) => {
    if (e.target.matches('.btn-purchase:not(:disabled)')) {
        const { skillName, agentId } = e.target.dataset;
        handlePurchase(agentId, skillName, e.target);
    }
});
```
