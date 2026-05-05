---
status: completed
---

# Prompt 5: API to Purchase a Skill

**Status:** Not Started

## Objective
Create the core backend API endpoint that allows a user to purchase a skill. This endpoint will verify the transaction and record the purchase in the database.

## Explanation
This is the most critical part of the monetization flow. The user will have confirmed the transaction on the frontend with their wallet. The frontend will then send the transaction signature to this backend endpoint. The backend must verify that the transaction was successful and that the correct amount was transferred to the right recipient before recording the purchase.

## Instructions

1.  **Create the API Endpoint:**
    *   Create `api/skill/purchase.js` to handle `POST` requests.

2.  **Validate the Request:**
    *   The request body should include:
        *   `agent_id`
        *   `skill_name`
        *   `transaction_signature`
    *   The user must be authenticated.

3.  **Verify the Solana Transaction:**
    *   Use the Solana RPC `getTransaction` method with the provided `transaction_signature`.
    *   Check that the transaction was successful (`err` is null).
    *   Fetch the skill price from the `agent_skill_prices` table.
    *   Inspect the transaction's post-balances and pre-balances to confirm:
        *   The buyer's balance decreased by the correct amount.
        *   The seller's (agent owner's) balance increased by the correct amount.
        *   The currency mint matches the one specified for the skill.

4.  **Record the Purchase:**
    *   If transaction verification is successful, insert a new record into the `skill_purchases` table.
    *   Store the `user_id`, `agent_id`, `skill_name`, `transaction_signature`, `amount`, and `currency_mint`.

5.  **Return a Response:**
    *   Return a success message if the purchase was recorded.
    *   Return a detailed error if verification fails at any step.

## Code Example (Node.js with `@solana/web3.js`)

```javascript
// In /api/skill/purchase.js

import { Connection, PublicKey } from '@solana/web3.js';
import { supabase } from '../_lib/supabase';
import { authenticate } from '../_lib/auth';

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL;
const connection = new Connection(SOLANA_RPC_URL, 'confirmed');

export default async function handler(req, res) {
  const user = await authenticate(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { agent_id, skill_name, signature } = req.body;

  // 1. Fetch expected price and seller wallet
  // ... (get price from agent_skill_prices and seller wallet from agents table)

  // 2. Verify transaction
  try {
    const tx = await connection.getTransaction(signature, { maxSupportedTransactionVersion: 0 });
    if (tx.meta.err) throw new Error('Transaction failed on-chain');

    // ... (logic to parse transaction accounts and balances)
    // ... (compare actual transfer amount/wallets with expected price/wallets)

    // 3. Record purchase in DB if verification passes
    const { error } = await supabase.from('skill_purchases').insert({
      user_id: user.id,
      agent_id,
      skill_name,
      transaction_signature: signature,
      // ... (amount, currency_mint)
    });

    if (error) throw error;

    res.status(200).json({ success: true, message: 'Purchase successful!' });
  } catch (err) {
    console.error('Purchase verification failed:', err);
    res.status(400).json({ success: false, error: 'Transaction verification failed.' });
  }
}
```
