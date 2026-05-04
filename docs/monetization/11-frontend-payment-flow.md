# Prompt 11: Frontend Payment Flow and Wallet Signing

## Objective
Implement the client-side logic to receive the prepared transaction from the backend, prompt the user to sign it with their Solana wallet, and send it to the blockchain.

## Explanation
This prompt connects the UI to the user's wallet (e.g., Phantom, Solflare). It orchestrates the most critical part of the user-facing flow: approving the transaction.

## Instructions
1.  **File to Edit:**
    *   Continue working in your main chat component's JavaScript (e.g., `chat/src/App.svelte`).

2.  **Wallet Adapter Integration:**
    *   Ensure you have a Solana wallet adapter library integrated into your project. If not, you will need to add one (e.g., `@solana/wallet-adapter-react`, `@solana/wallet-adapter-base`). The project seems to have some wallet integration already, so tap into that. A function like `detectSolanaWallet()` is mentioned elsewhere.

3.  **Create `handlePaymentFlow` Function:**
    *   This async function will be called when the user clicks "Pay and Continue" in the modal.
    *   It should accept the `paymentDetails` (skill\_name, agent\_id, etc.) as an argument.

4.  **Step-by-Step Logic within `handlePaymentFlow`:**
    *   **a. Fetch Transaction:** Make a `POST` request to your `/api/payments/prepare-skill-payment` endpoint, sending the `agent_id` and `skill_name`.
    *   **b. Deserialize Transaction:** The API will return a Base64 encoded transaction. You need to deserialize it back into a `Transaction` object.
        ```javascript
        import { Transaction } from '@solana/web3.js';
        const { paymentId, transaction: base64Transaction } = await response.json();
        const transaction = Transaction.from(Buffer.from(base64Transaction, 'base64'));
        ```
    *   **c. Connect to Wallet:** Ensure the user's wallet is connected. If not, prompt them to connect.
    *   **d. Sign and Send:** Use the wallet adapter to sign and send the transaction. This is typically a single function call that both prompts the user in their wallet and, upon approval, sends the transaction to the network.
        ```javascript
        const wallet = getSolanaWallet(); // Your project's way of getting the adapter
        const signature = await wallet.sendTransaction(transaction, connection);
        ```
    *   **e. Confirm Transaction:** Wait for the transaction to be confirmed by the Solana cluster.
        ```javascript
        await connection.confirmTransaction(signature, 'confirmed');
        ```
    *   **f. Notify Backend:** Once confirmed, make a final API call to your backend to verify the payment (this will be built in the next prompt). Pass the `paymentId` and the `signature`.
    *   **g. Return Status:** Return a success or failure object to the modal's logic.

## Code Example (Frontend - Chat Component)

```javascript
// This function is called from the modal's "Pay" button
async function handlePaymentFlow(paymentDetails) {
  try {
    // a. Fetch Transaction
    const prepRes = await fetch('/api/payments/prepare-skill-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: agent.id, // Assuming agent is in scope
        skill_name: paymentDetails.skill_name
      })
    });
    if (!prepRes.ok) throw new Error('Failed to prepare payment.');
    
    const { paymentId, transaction: base64Transaction } = await prepRes.json();

    // b. Deserialize
    const transaction = Transaction.from(Buffer.from(base64Transaction, 'base64'));

    // c. & d. Connect, Sign, and Send
    const wallet = getSolanaWallet();
    if (!wallet.connected) await wallet.connect();
    
    const connection = new Connection(process.env.SOLANA_RPC_URL);
    const signature = await wallet.sendTransaction(transaction, connection);

    // e. Confirm
    await connection.confirmTransaction(signature, 'confirmed');

    // f. Notify Backend
    const confirmRes = await fetch('/api/payments/confirm-skill-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId, signature })
    });
    if (!confirmRes.ok) throw new Error('Payment confirmation failed on server.');

    // g. Return Success
    return { success: true };

  } catch (error) {
    console.error("Payment failed:", error);
    // Optionally display a user-friendly error message
    return { success: false, error: error.message };
  }
}
```
