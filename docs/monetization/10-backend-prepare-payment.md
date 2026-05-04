# Prompt 10: Backend Endpoint to Prepare Payment

## Objective
Create a backend endpoint that prepares a Solana transaction for the user to sign to pay for a skill.

## Explanation
This is a critical security step. The server, not the client, must construct the transaction. This prevents tampering with the payment amount or destination. This endpoint will generate an unsigned transaction that transfers the correct amount from the user to the appropriate account and return it to the client for signing.

## Instructions
1.  **Create API Route:**
    *   Set up a new endpoint: `POST /api/payments/prepare-skill-payment`.
    *   This endpoint must be authenticated.

2.  **Request Body:**
    *   The endpoint should accept a JSON body with `agent_id` and `skill_name`.

3.  **Backend Logic:**
    *   **Fetch Price:** Using `agent_id` and `skill_name`, look up the price (`amount` and `currency_mint`) from the `agent_skill_prices` table. If no price is found, return an error.
    *   **Identify Payer and Receiver:**
        *   The **payer** is the authenticated user making the request. Get their public key.
        *   The **receiver** is the agent's associated treasury or holdings account. This address should be stored with the agent's data.
    *   **Construct the Transaction:**
        *   Using the Solana Web3.js library (`@solana/web3.js`), create a new `Transaction`.
        *   Add a `spl-token` `createTransfer` instruction.
        *   **Source:** The user's Associated Token Account (ATA) for the given `currency_mint`.
        *   **Destination:** The agent's treasury ATA for the same `currency_mint`.
        *   **Amount:** The `amount` from the database.
        *   **Owner:** The user's public key.
    *   **Set Blockhash and Fee Payer:**
        *   Get a recent blockhash from the Solana cluster.
        *   Set the `recentBlockhash` and `feePayer` (the user) on the transaction.
    *   **Create Payment Record:**
        *   Create a record in a new `skill_payments` table with a `pending` status. Include `user_id`, `agent_id`, `skill_name`, `amount`, and the transaction's blockhash for later reference. Store a unique ID for this payment intent.
    *   **Serialize and Respond:**
        *   Serialize the *unsigned* transaction and encode it (e.g., in Base64).
        *   Return the serialized transaction and the unique payment ID to the frontend.

## Code Example (Backend - `/api/payments/prepare-skill-payment.js`)

```javascript
import { Transaction, SystemProgram, PublicKey } from '@solana/web3.js';
import { createTransferInstruction } from '@solana/spl-token';
import { getAssociatedTokenAddress } from '@solana/spl-token';

// --- Inside your API handler ---

const { agent_id, skill_name } = req.body;
const user = await getAuthenticatedUser(req);

// 1. Fetch skill price and agent details
const priceInfo = await db.getSkillPrice(agent_id, skill_name);
const agent = await db.getAgentById(agent_id);
if (!priceInfo || !agent) {
  return res.status(404).json({ error: 'Skill or agent not found.' });
}

// 2. Define parties
const payerPublicKey = new PublicKey(user.solana_pubkey);
const receiverPublicKey = new PublicKey(agent.treasury_address); // The agent's main treasury wallet
const currencyMint = new PublicKey(priceInfo.currency_mint);

// 3. Find the ATAs for the token transfer
const payerAta = await getAssociatedTokenAddress(currencyMint, payerPublicKey);
const receiverAta = await getAssociatedTokenAddress(currencyMint, receiverPublicKey);

// 4. Create the transfer instruction
const transferInstruction = createTransferInstruction(
  payerAta,       // from
  receiverAta,    // to
  payerPublicKey, // from's owner
  priceInfo.amount  // amount
);

// 5. Create the transaction
const connection = new Connection(process.env.SOLANA_RPC_URL);
const { blockhash } = await connection.getRecentBlockhash();

const transaction = new Transaction({
  recentBlockhash: blockhash,
  feePayer: payerPublicKey,
}).add(transferInstruction);

// 6. Create a pending payment record
const paymentIntent = await db.createPaymentIntent({
  userId: user.id,
  agentId: agent.id,
  skillName: skill_name,
  amount: priceInfo.amount,
  reference: blockhash, // Use blockhash or a new UUID as a reference
});

// 7. Serialize and respond
const serializedTransaction = transaction.serialize({
  requireAllSignatures: false,
}).toString('base64');

res.status(200).json({
  paymentId: paymentIntent.id,
  transaction: serializedTransaction,
});
```
