# Prompt 05: API Endpoint to Initiate a Purchase

## Objective
Create a backend endpoint that initiates the skill purchase process by creating a pending purchase record and returning transaction details to the client.

## Explanation
The purchase flow begins when a user clicks "buy". This endpoint will be responsible for creating a record in the `user_skill_purchases` table with a 'pending' status. For a Solana-based payment, it will then generate the necessary parameters for the frontend to construct a Solana Pay transaction request.

## Instructions
1.  **Create the API Endpoint File:**
    *   Create a new file, e.g., `api/marketplace/purchase.js`.

2.  **Implement the `POST` Handler:**
    *   **Authentication:** Get the logged-in user.
    *   **Input Validation:** Expect an `agent_id` and `skill_id` in the request body. Use `zod` for validation.
    *   **Check for Existing Purchase:** Verify the user hasn't already bought this skill.
    *   **Fetch Skill Price:** Get the current price from `agent_skill_prices`.
    *   **Create Pending Record:** Insert a new row into `user_skill_purchases` with `status = 'pending'`.
    *   **Generate Solana Pay Parameters:**
        *   Create a unique reference key for the transaction (e.g., the new purchase ID).
        *   Return the recipient address (the creator's wallet), the SPL token mint (e.g., USDC), the amount, and the reference key.
    *   **Return Response:** Send back the Solana Pay parameters and the `purchaseId` to the client.

## Code Example (`api/marketplace/purchase.js`)

```javascript
import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { error, json, wrap } from '../_lib/http.js';
import { z } from 'zod';
import { Keypair } from '@solana/web3.js'; // Assuming solana-sdk is available

const purchaseSchema = z.object({
  agent_id: z.string().uuid(),
  skill_id: z.string().min(1),
});

export default wrap(async (req, res) => {
  if (req.method !== 'POST') return error(res, 405, 'method_not_allowed');

  const user = await getSessionUser(req);
  if (!user) return error(res, 401, 'unauthorized');

  const body = purchaseSchema.parse(await req.json());

  // Fetch price and creator info
  const [priceInfo] = await sql`
    SELECT id, creator_id, amount, currency_mint
    FROM agent_skill_prices
    WHERE agent_id = ${body.agent_id} AND skill_id = ${body.skill_id} AND deleted_at IS NULL
  `;
  if (!priceInfo) return error(res, 404, 'price_not_found');

  // TODO: Fetch creator's wallet address from users table
  const creatorWallet = '...'; // Placeholder

  // Create pending purchase record
  const [purchase] = await sql`
    INSERT INTO user_skill_purchases (user_id, agent_id, skill_id, price_id, status)
    VALUES (${user.id}, ${body.agent_id}, ${body.skill_id}, ${priceInfo.id}, 'pending')
    RETURNING id
  `;

  // Return details for Solana Pay transaction
  return json(res, {
    purchaseId: purchase.id,
    recipient: creatorWallet,
    amount: (priceInfo.amount / 1_000_000).toString(), // Assuming 6 decimals for USDC
    splToken: priceInfo.currency_mint,
    reference: purchase.id,
    label: `3D-Agent Skill: ${body.skill_id}`,
  });
});
```
