---
status: not-started
---

# Prompt 6: Frontend - Purchase Skill Flow

## Objective
Implement the frontend flow for a user to purchase a skill, including a confirmation modal that shows the price and triggers the transaction.

## Explanation
When a user clicks on a paid skill they don't own, we need to present them with a purchase confirmation modal. This modal will display the skill's name, price, and ask for confirmation. Upon confirmation, it will initiate a Solana transaction to transfer the required amount from the user's wallet to the creator's wallet.

## Instructions
1.  **Create the Purchase Modal:**
    *   Design and create a modal component that can be dynamically shown when a purchase is initiated.
    *   The modal should clearly display the skill name, price, and currency.
    *   It should have "Confirm Purchase" and "Cancel" buttons.

2.  **Trigger the Modal:**
    *   In the agent detail view in the marketplace, add a "Purchase" button next to paid skills that the user doesn't own.
    *   When this button is clicked, open the purchase modal and populate it with the skill's data.

3.  **Handle the Transaction:**
    *   When the "Confirm Purchase" button is clicked, use the connected wallet adapter to create and sign a Solana transaction.
    *   The transaction will be a simple SPL token transfer from the user's wallet to the skill creator's wallet.
    *   Display feedback to the user while the transaction is being processed and after it has been confirmed or failed.

## Code Example (Frontend - Transaction Logic)

```javascript
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { getAssociatedTokenAddress, createTransferInstruction } from '@solana/spl-token';
import { Transaction, PublicKey } from '@solana/web3.js';

// Inside your purchase confirmation handler

const { connection } = useConnection();
const { publicKey, sendTransaction } = useWallet();

async function handlePurchase(skill) {
  if (!publicKey) {
    alert('Please connect your wallet first.');
    return;
  }

  const { amount, currency_mint, creator_wallet } = skill.price;

  const fromTokenAccount = await getAssociatedTokenAddress(new PublicKey(currency_mint), publicKey);
  const toTokenAccount = await getAssociatedTokenAddress(new PublicKey(currency_mint), new PublicKey(creator_wallet));

  const transaction = new Transaction().add(
    createTransferInstruction(
      fromTokenAccount,
      toTokenAccount,
      publicKey,
      amount
    )
  );

  try {
    const signature = await sendTransaction(transaction, connection);
    await connection.confirmTransaction(signature, 'processed');
    
    // After successful transaction, call the backend to record the purchase
    // ...
    
  } catch (error) {
    console.error('Transaction failed:', error);
    alert('Transaction failed. Please try again.');
  }
}
```
