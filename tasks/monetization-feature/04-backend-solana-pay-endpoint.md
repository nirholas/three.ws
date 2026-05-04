---
status: not-started
---

# Prompt 4: Backend - Create Solana Pay Endpoint

## Objective
Create a backend endpoint that generates a Solana Pay transaction for a skill purchase, allowing for a seamless on-chain payment experience.

## Explanation
To enable decentralized payments, we will use Solana Pay. This requires a dedicated backend endpoint that, when requested, constructs and returns a Solana transaction tailored to the specific skill purchase. The frontend will then use this to generate a QR code for mobile wallets or to prompt browser extension wallets.

## Instructions
1.  **Create a New API Route:**
    *   Create a new file at `/api/payments/solana-pay.js`.

2.  **Implement the Endpoint Logic:**
    *   The endpoint should handle `POST` requests.
    *   It should expect a JSON body containing the `agent_id` and `skill_name`.
    *   It needs to fetch the skill's price from the `agent_skill_prices` table.
    *   It must identify the recipient's wallet address (the agent creator's address).
    *   Using the Solana SDK (`@solana/web3.js`), construct a system transfer transaction.
    *   The transaction should transfer the correct `amount` of the specified `currency_mint` from the buyer to the creator.

3.  **Return Solana Pay Spec Response:**
    *   The endpoint must return a JSON object that conforms to the Solana Pay specification.
    *   This includes a base64-encoded, serialized transaction, a `label`, and a `message`.

## Code Example (`/api/payments/solana-pay.js`)

```javascript
import { sql } from '../_lib/db.js';
import { json, error, wrap, readJson } from '../_lib/http.js';
import { getSessionUser } from '../_lib/auth.js';
import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { z } from 'zod';

const purchaseSchema = z.object({
  agent_id: z.string().uuid(),
  skill_name: z.string().min(1).max(128),
});

export default wrap(async (req, res) => {
  if (req.method !== 'POST') return error(res, 405, 'method_not_allowed');

  const user = await getSessionUser(req);
  if (!user) return error(res, 401, 'unauthorized');

  const body = await readJson(req);
  const { agent_id, skill_name } = purchaseSchema.parse(body);

  // 1. Fetch price and creator's wallet
  const [priceInfo] = await sql`...`; // Get price and creator wallet
  if (!priceInfo) return error(res, 404, 'price_not_found');

  // 2. Setup Solana connection
  const connection = new Connection(process.env.SOLANA_RPC_URL);
  const buyer = new PublicKey(user.wallet_address);
  const recipient = new PublicKey(priceInfo.creator_wallet_address);

  // 3. Create transaction
  const { blockhash } = await connection.getLatestBlockhash();
  const tx = new Transaction({
    recentBlockhash: blockhash,
    feePayer: buyer,
  }).add(
    SystemProgram.transfer({
      fromPubkey: buyer,
      toPubkey: recipient,
      lamports: priceInfo.amount,
    })
  );

  // 4. Serialize and encode
  const serializedTx = tx.serialize({ requireAllSignatures: false });
  const base64Tx = serializedTx.toString('base64');

  // 5. Return Solana Pay response
  return json(res, 200, {
    transaction: base64Tx,
    label: '3D-Agent Skill Purchase',
    message: `Purchase '${skill_name}' for Agent`,
  });
});
```
