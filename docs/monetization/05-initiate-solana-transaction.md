# Prompt 5: Initiate Solana Transaction on Purchase

## Objective
Wire up the "Confirm Purchase" button in the modal to construct and request the user to sign a Solana transaction that transfers the specified amount to the creator's wallet.

## Explanation
This is where the user's action translates into an on-chain event. After connecting their wallet, clicking "Confirm" should prompt them, via their wallet extension, to approve a transaction that pays for the skill.

## Instructions
1.  **Fetch Creator Wallet:**
    *   The agent data from the backend must include the creator's public key (wallet address) where funds should be sent.
    *   Modify the `/api/marketplace/agents/:id` endpoint to include `creator_wallet_address`.

2.  **Construct Transaction (`src/marketplace.js`):**
    *   In the event listener for the `#modal-confirm-purchase` button:
    *   Get the connected wallet object from the wallet adapter.
    *   Fetch the skill price (amount) and the creator's wallet address.
    *   Use `@solana/web3.js` to create a new `Transaction` object.
    *   Add a `SystemProgram.transfer` instruction to the transaction, specifying the sender (user's public key), recipient (creator's public key), and amount in lamports.

3.  **Send and Confirm Transaction:**
    *   Use the wallet adapter's `sendTransaction` method to send the transaction to the network.
    *   Await the confirmation of the transaction.
    *   Provide feedback to the user based on whether the transaction succeeds or fails.

## Code Example (JavaScript - `src/marketplace.js`)
```javascript
import { Connection, SystemProgram, Transaction, PublicKey } from '@solana/web3.js';
// Assume `wallet` is the connected wallet adapter object and `connection` is a Connection object.

document.getElementById('modal-confirm-purchase').addEventListener('click', async () => {
    const agent = getCurrentAgentData();
    const skillName = document.getElementById('modal-skill-name').textContent;
    const price = agent.skill_prices[skillName];
    
    const recipient = new PublicKey(agent.creator_wallet_address);
    const lamports = price.amount;

    const transaction = new Transaction().add(
        SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: recipient,
            lamports: lamports,
        })
    );

    try {
        const signature = await wallet.sendTransaction(transaction, connection);
        await connection.confirmTransaction(signature, 'processed');
        console.log('Transaction successful with signature:', signature);
        // Next step: Mint an NFT to prove ownership.
    } catch (error) {
        console.error('Transaction failed:', error);
        // Show an error message to the user.
    }
});
```
