# Prompt 7: Frontend Payment and Transaction Signing

## Status
- [ ] Not Started

## Objective
Implement the frontend logic to receive the serialized transaction from the backend, prompt the user to sign it with their wallet, and send the signed transaction to the network.

## Explanation
This prompt connects the UI to the backend payment API. When the user confirms a purchase, the frontend will fetch the transaction, use the wallet adapter to sign it, and then broadcast it to the Solana network.

## Instructions
1.  **Update Modal Event Listener:**
    *   In the `handlePurchaseClick` logic, add a click event listener to the `modal-confirm-btn`.
    *   This listener will trigger the payment process.

2.  **Implement the Payment Flow:**
    *   When the confirm button is clicked, make a `POST` request to your `/api/payments/prepare-transaction` endpoint.
    *   Send the necessary data: `skillName`, `agentId`, and the connected user's public key.
    *   The backend will respond with a base64-encoded serialized transaction.

3.  **Sign and Send the Transaction:**
    *   Deserialize the transaction received from the backend.
    *   Use the connected wallet adapter's `signTransaction` method.
    *   Once signed, use the `connection.sendRawTransaction` method from `@solana/web3.js` to broadcast it.
    *   Wait for the transaction to be confirmed and then notify the user of the result (success or failure).

## Code Example (Frontend Payment Logic)
```javascript
// Add this to your marketplace.js or a dedicated payments module
import { Connection, Transaction } from '@solana/web3.js';
import { getConnectedWallet, getConnectedWalletAddress } from './wallet.js';

const connection = new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC_URL, 'confirmed');

async function handleConfirmPurchase() {
  const skillData = JSON.parse(document.getElementById('modal-confirm-btn').dataset.skillData);
  const buyerPublicKey = getConnectedWalletAddress();
  const wallet = getConnectedWallet();

  if (!buyerPublicKey || !wallet) {
    alert('Please connect your wallet first.');
    return;
  }

  // 1. Fetch transaction from backend
  const response = await fetch('/api/payments/prepare-transaction', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...skillData,
      buyerPublicKey,
      agentId: currentAgent.id, // Assuming 'currentAgent' is available in scope
    }),
  });

  const { transaction: base64Transaction } = await response.json();
  const transactionBuffer = Buffer.from(base64Transaction, 'base64');
  const transaction = Transaction.from(transactionBuffer);

  try {
    // 2. Sign the transaction
    const signedTransaction = await wallet.signTransaction(transaction);

    // 3. Send and confirm the transaction
    const signature = await connection.sendRawTransaction(signedTransaction.serialize());
    await connection.confirmTransaction(signature, 'confirmed');

    alert(`Purchase successful! Transaction signature: ${signature}`);
    // Next step: Update UI to show the user owns the skill.
  } catch (error) {
    console.error('Purchase failed:', error);
    alert('Purchase failed. See console for details.');
  } finally {
    // Hide the modal
    document.getElementById('purchase-confirm-modal').classList.add('modal-hidden');
  }
}

// Attach this to the confirm button
document.getElementById('modal-confirm-btn').addEventListener('click', handleConfirmPurchase);

```
