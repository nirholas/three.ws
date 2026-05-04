# Prompt 5: Execute SPL Token Transfer for Purchase

**Status:** - [ ] Not Started

## Objective
Implement the client-side logic to construct and send a Solana transaction to transfer SPL tokens (e.g., USDC) from the user's wallet to the creator's wallet when the "Confirm Purchase" button is clicked.

## Explanation
This is the core of the purchase transaction. When a user confirms they want to buy a skill, the frontend needs to create a transaction, have the user sign it with their wallet, and send it to the Solana network.

## Instructions
1.  **Gather Transaction Details:**
    *   When the "Confirm Purchase" button is clicked, you need the following information:
        *   User's public key (from the connected wallet).
        *   Creator's public key (this should be part of the agent's data).
        *   The price (amount).
        *   The currency mint address (e.g., USDC mint address).

2.  **Construct the Transaction:**
    *   Use `@solana/web3.js` to create a new `Transaction`.
    *   Add an instruction to the transaction to transfer the SPL token. You will need functions from `@solana/spl-token` to create the transfer instruction.
    *   The instruction will need the source token account, destination token account, amount, and the user's public key as the owner.
    *   **Important:** You'll need to find the user's and the creator's associated token accounts for the given mint.

3.  **Sign and Send the Transaction:**
    *   Use the `sendTransaction` method provided by the wallet adapter, passing it the transaction you constructed.
    *   The wallet adapter will prompt the user to approve and sign the transaction.
    *   Await the confirmation of the transaction.

## Code Example (JavaScript in `src/marketplace.js`)

```javascript
// This assumes a wallet adapter that provides a `publicKey` and `sendTransaction` function.
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddress, createTransferInstruction } from '@solana/spl-token';

const connection = new Connection('your_rpc_url');

$('modal-confirm-purchase-btn').addEventListener('click', async () => {
  const agent = window.currentAgent;
  const skillName = $('modal-skill-name').textContent;
  const priceInfo = agent.skill_prices[skillName];
  const creatorPublicKey = new PublicKey(agent.creator_address);
  const userPublicKey = wallet.publicKey;

  if (!priceInfo || !creatorPublicKey || !userPublicKey) {
    console.error('Missing required info for transaction');
    return;
  }

  try {
    const currencyMint = new PublicKey(priceInfo.currency_mint);
    
    // Get the associated token accounts
    const userTokenAccount = await getAssociatedTokenAddress(currencyMint, userPublicKey);
    const creatorTokenAccount = await getAssociatedTokenAddress(currencyMint, creatorPublicKey);

    const transaction = new Transaction().add(
      createTransferInstruction(
        userTokenAccount,
        creatorTokenAccount,
        userPublicKey,
        priceInfo.amount,
        [],
      )
    );

    const signature = await wallet.sendTransaction(transaction, connection);
    await connection.confirmTransaction(signature, 'processed');

    console.log('Transaction successful with signature:', signature);
    // Next step: Call backend to record the purchase
    
  } catch (error) {
    console.error('Transaction failed:', error);
    // Show error message to user
  }
});
```
