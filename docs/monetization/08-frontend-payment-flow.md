---
status: not-started
---

# Prompt 8: Frontend - Payment Flow

## Objective
Implement the client-side logic to handle the entire skill purchase flow: requesting the transaction, getting the user's signature, sending it to the network, and confirming it.

## Explanation
This prompt connects the "Unlock" button to the backend and the user's wallet. When a user clicks the button, the frontend will orchestrate the process of fetching, signing, and broadcasting the payment transaction on the Solana network. This is a critical user-facing step that needs to be smooth and provide clear feedback.

## Instructions
1.  **Add Event Listener:**
    *   In `src/marketplace.js`, add a click event listener to the container of the skills list (or delegate from a higher-level element). When a `.btn-unlock-skill` is clicked, the handler should fire.

2.  **Request the Transaction:**
    *   Inside the event handler, get the `agentId` and `skillName` from the button's `data-*` attributes.
    *   Get the connected user's public key from the `useWallet` hook. If no wallet is connected, prompt the user to connect first.
    *   Send a `POST` request to your `/api/payments/create-transaction` endpoint with the `agentId`, `skillName`, and `buyerPublicKey`.
    *   Show a loading indicator to the user (e.g., disable the button and show a spinner).

3.  **Deserialize and Sign:**
    *   The API will respond with a base64-encoded transaction string.
    *   Decode the base64 string into a buffer.
    *   Use `Transaction.from()` from `@solana/web3.js` to deserialize the buffer back into a `Transaction` object.
    *   Use the `signTransaction` function from the `useWallet` hook to prompt the user to sign the transaction with their wallet. This will open a popup in their wallet extension.

4.  **Send and Confirm the Transaction:**
    *   Once the user signs, the `signTransaction` function will return the signed transaction.
    *   Serialize the signed transaction and use `connection.sendRawTransaction` to broadcast it to the Solana network. This will return a transaction signature (ID).
    *   Use `connection.confirmTransaction` with the signature to wait for the transaction to be confirmed by the network. This is crucial for ensuring the payment went through before considering the skill unlocked.

5.  **Provide Feedback:**
    *   While confirming, keep the user informed (e.g., "Confirming transaction...").
    *   On successful confirmation, show a success message ("Skill unlocked!").
    *   You should then refresh the UI to show the skill as "Unlocked", either by re-fetching user data or just updating the DOM for that specific skill.
    *   If any step fails (user rejects signature, transaction fails), show a clear error message.

## Code Example (`src/marketplace.js`)

```javascript
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { Transaction } from '@solana/web3.js';
// ... other imports

// Add this listener in your initialization code
document.getElementById('d-skills').addEventListener('click', async (event) => {
    if (!event.target.matches('.btn-unlock-skill')) return;

    const button = event.target;
    const { agentId, skillName } = button.dataset;
    const { publicKey, signTransaction } = useWallet(); // From wallet adapter context
    const { connection } = useConnection(); // From wallet adapter context

    if (!publicKey || !signTransaction) {
        showToast('Please connect your wallet first.', 'error');
        return;
    }

    try {
        button.disabled = true;
        button.textContent = 'Processing...';

        // 1. Fetch transaction from backend
        const response = await fetch('/api/payments/create-transaction', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentId, skillName, buyerPublicKey: publicKey.toBase58() })
        });
        if (!response.ok) throw new Error('Failed to create transaction.');
        const { transaction: base64Transaction } = await response.json();

        // 2. Deserialize, sign, and send
        const transaction = Transaction.from(Buffer.from(base64Transaction, 'base64'));
        const signedTransaction = await signTransaction(transaction);
        const signature = await connection.sendRawTransaction(signedTransaction.serialize());

        // 3. Confirm transaction
        await connection.confirmTransaction(signature, 'confirmed');

        showToast('Skill unlocked successfully!', 'success');
        
        // 4. Update UI
        button.outerHTML = `<span class="price-badge price-unlocked">✅ Unlocked</span>`;
        // Optionally, add skillName to a local `unlockedSkills` set.

    } catch (error) {
        console.error('Purchase failed:', error);
        showToast(error.message || 'Purchase failed. Please try again.', 'error');
        button.disabled = false;
        button.textContent = 'Unlock for ...'; // Restore original text
    }
});
```
