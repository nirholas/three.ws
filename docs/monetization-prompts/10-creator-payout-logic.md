# Prompt 10: Logic for Creator Payouts and Platform Fees

**Status:** - [ ] Not Started

## Objective
Implement the logic, both on-chain and off-chain, for splitting payments between the agent creator and the platform.

## Explanation
To create a sustainable business model, the platform will likely take a small fee from each skill purchase. This requires a system to automatically split the incoming funds. This can be done either on-chain with a smart contract or off-chain by having payments go to a platform wallet which then distributes the funds. An on-chain approach is more transparent.

## Instructions
1.  **Design the Payout Flow:**
    *   Decide on the fee structure (e.g., a 5% platform fee).
    *   Decide on the mechanism:
        *   **On-chain (preferred):** A smart contract (or a simple wallet acting as an escrow) receives the payment, then immediately splits it between the creator and the platform treasury.
        *   **Off-chain:** Payment goes to a platform-controlled wallet. A backend process then periodically calculates and sends the creator's share to their wallet.

2.  **Implement On-Chain Split (if chosen):**
    *   This is a more advanced task involving Solana smart contract development (e.g., using Anchor).
    *   The frontend transaction would change to call this new smart contract instead of a direct SPL transfer.
    *   The smart contract would require two instructions in the transaction: one to transfer the total amount to the contract, and another to trigger the split.

3.  **Implement Off-Chain Split (simpler alternative):**
    *   Modify the SPL transfer logic from Prompt 5. Instead of transferring to the creator's address, transfer to a platform-owned treasury address. This address should be configured per-skill or per-agent in the `agent_skill_prices` table.
    *   Create a backend cron job or batch process (`/api/cron/process-payouts.js`).
    *   This job runs periodically (e.g., daily), queries all purchase records since the last run, calculates the creator's share for each, and queues up the payout transactions.
    *   Use a secure backend wallet to sign and send these payout transactions.

## Code Example (Off-chain Payout Cron Job - `/api/cron/process-payouts.js`)

```javascript
// This is a conceptual example of a cron job for Vercel
import { getDB } from './_lib/db';
import { Connection, Keypair, SystemProgram, Transaction } from '@solana/web3.js';
// And SPL token transfer functions

const PLATFORM_FEE_PERCENT = 5;

export default async function handler(req, res) {
  // Secure this endpoint, e.g., with a secret key
  
  const db = getDB();
  const pendingPurchases = await db.getUnprocessedPurchases();

  const creatorPayouts = {}; // { [creator_address]: amount_to_pay }

  for (const purchase of pendingPurchases) {
    const creatorShare = purchase.amount * (1 - PLATFORM_FEE_PERCENT / 100);
    const creator = purchase.creator_address;
    creatorPayouts[creator] = (creatorPayouts[creator] || 0) + creatorShare;
  }

  // Use a secure way to load your backend wallet
  const platformWallet = Keypair.fromSecretKey(...); 
  const connection = new Connection('your_rpc_url');

  for (const [creator, amount] of Object.entries(creatorPayouts)) {
    // Construct and send transaction to pay out `amount` to `creator`
    // This involves creating and sending an SPL token transfer from the platform's wallet
    // ...
  }
  
  // Mark purchases as processed in the DB
  await db.markPurchasesAsProcessed(pendingPurchases.map(p => p.id));

  res.status(200).json({ success: true, message: 'Payouts processed.' });
}
```
