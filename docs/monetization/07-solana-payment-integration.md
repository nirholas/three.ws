---
status: not-started
---

# Prompt 7: Solana Payment Integration

## Objective
Integrate the Solana wallet-adapter to process skill purchase transactions on the Solana blockchain.

## Explanation
To handle payments in a decentralized way, we will use the Solana wallet-adapter to connect to the user's wallet (like Phantom) and request them to sign and send the transaction.

## Instructions
1.  **Add Wallet-Adapter Dependencies:**
    *   Include the necessary wallet-adapter scripts in `marketplace.html`.
    *   You will need `@solana/wallet-adapter-base`, `@solana/wallet-adapter-wallets`, and `@solana/web3.js`.

2.  **Implement Connection Logic:**
    *   In `src/marketplace.js`, add a "Connect Wallet" button and the logic to connect to the user's wallet.
    *   Store the user's public key when they connect.

3.  **Implement the Purchase Transaction:**
    *   When the user confirms the purchase in the modal, construct a Solana transaction.
    *   The transaction will transfer the required amount of SOL or SPL tokens (like USDC) from the user's wallet to the creator's wallet.
    *   Use the wallet-adapter to ask the user to sign and send the transaction.

## Code Example (JavaScript - `src/marketplace.js`)

```javascript
// Inside the 'confirm-purchase' button's event listener

const provider = getProvider(); // From your wallet-adapter setup
const connection = new solanaWeb3.Connection(solanaWeb3.clusterApiUrl('devnet'));

const transaction = new solanaWeb3.Transaction().add(
    solanaWeb3.SystemProgram.transfer({
        fromPubkey: user.publicKey,
        toPubkey: new solanaWeb3.PublicKey(creatorWalletAddress),
        lamports: price.amount,
    })
);

try {
    const signature = await provider.sendTransaction(transaction, connection);
    await connection.confirmTransaction(signature, 'processed');
    // On success, notify the backend to unlock the skill
} catch (error) {
    console.error("Transaction failed", error);
}
```
