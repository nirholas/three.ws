# Prompt 6: Create Backend API for Payment Transactions

## Status
- [ ] Not Started

## Objective
Create a backend API endpoint that prepares a Solana transaction for a skill purchase and sends it to the frontend for signing.

## Explanation
For security and reliability, the transaction should be constructed on the backend. The backend will determine the correct accounts (buyer, seller, mint) and amounts, create an unsigned transaction, serialize it, and send it to the frontend. The frontend's only job is to get the user's signature.

## Instructions
1.  **Create a New API Endpoint:**
    *   Create a new API route, for example, `POST /api/payments/prepare-transaction`.
    *   This endpoint will require authentication to ensure only logged-in users can make purchases.

2.  **Implement the Endpoint Logic:**
    *   The endpoint should accept a payload containing the `skill_name`, `agent_id`, and the buyer's public key.
    *   On the backend, retrieve the skill's price and currency mint from the `agent_skill_prices` table.
    *   Fetch the agent creator's wallet address (the seller).
    *   Construct a Solana transaction using `@solana/web3.js`. The transaction will be a simple SPL token transfer from the buyer's wallet to the seller's wallet.
    *   The transaction should be recent and have a recent blockhash.
    *   Serialize the transaction and send it back to the frontend in a base64-encoded format.

## Code Example (Backend - `/api/payments/prepare-transaction.js`)
```javascript
// /api/payments/prepare-transaction.js
import { Connection, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import { getOrCreateAssociatedTokenAccount, createTransferInstruction } from '@solana/spl-token';
import { getSkillPrice, getAgentCreatorWallet } from './_db.js'; // Placeholder for DB functions

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { skillName, agentId, buyerPublicKey } = req.body;
  
  // 1. Fetch skill price and seller's address
  const priceInfo = await getSkillPrice(agentId, skillName);
  const sellerPublicKey = await getAgentCreatorWallet(agentId);

  if (!priceInfo || !sellerPublicKey) {
    return res.status(404).json({ error: 'Skill or seller not found' });
  }

  // 2. Setup Solana connection
  const connection = new Connection(process.env.SOLANA_RPC_URL, 'confirmed');
  const buyer = new PublicKey(buyerPublicKey);
  const seller = new PublicKey(sellerPublicKey);
  const mint = new PublicKey(priceInfo.currency_mint);
  
  // 3. Get or create token accounts
  const buyerTokenAccount = await getOrCreateAssociatedTokenAccount(connection, buyer, mint, buyer);
  const sellerTokenAccount = await getOrCreateAssociatedTokenAccount(connection, buyer, mint, seller);

  // 4. Create the transaction
  const transaction = new Transaction();
  transaction.add(
    createTransferInstruction(
      buyerTokenAccount.address,
      sellerTokenAccount.address,
      buyer,
      priceInfo.amount
    )
  );

  // 5. Set recent blockhash and fee payer
  transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  transaction.feePayer = buyer;
  
  // 6. Serialize and send to frontend
  const serializedTransaction = transaction.serialize({
    requireAllSignatures: false, // The buyer's signature is still needed
  });

  res.status(200).json({
    transaction: serializedTransaction.toString('base64'),
  });
}
```
