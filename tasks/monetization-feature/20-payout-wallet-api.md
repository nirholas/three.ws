# Prompt 20: Payout Wallet API

## Objective
Create backend API endpoints for creators to set, view, and delete their payout wallet addresses.

## Explanation
To receive their earnings, creators must specify a wallet address where they want to get paid. We need to build a secure API to manage this information. For simplicity, we'll start by supporting a single Solana wallet address per user. This information will be stored in the `agent_payout_wallets` table.

## Instructions
1.  **Create a New API File:**
    *   Create a file at `/api/billing/payout-wallet.js`.

2.  **Define the Endpoint Logic:**
    *   The endpoint must be authenticated.
    *   It should handle multiple HTTP methods:
        *   `GET`: To retrieve the user's currently configured payout wallet.
        *   `POST` or `PUT`: To create or update the payout wallet address.
        *   `DELETE`: To remove the payout wallet address.

3.  **Implement `GET` Handler:**
    *   Query the `agent_payout_wallets` table.
    *   Filter by the `user_id` from the session.
    *   Return the wallet address and chain, or `null` if none is configured.

4.  **Implement `POST`/`PUT` Handler:**
    *   Read the `address` and `chain` from the request body.
    *   Perform basic validation on the address format (e.g., check for a valid Solana address format).
    *   Use an `INSERT ... ON CONFLICT (user_id, chain) DO UPDATE ...` (UPSERT) statement to create or update the record in `agent_payout_wallets` for the given user and chain.

5.  **Implement `DELETE` Handler:**
    *   `DELETE` from the `agent_payout_wallets` table where `user_id` and `chain` match.

6.  **Add Vercel Routing:**
    *   Add a route in `vercel.json` for `/api/billing/payout-wallet`.

## Code Example (Backend - `/api/billing/payout-wallet.js`)

```javascript
import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { PublicKey } from '@solana/web3.js'; // For validation

export default wrap(async (req, res) => {
    if (cors(req, res, { methods: 'GET,POST,DELETE,OPTIONS', credentials: true })) return;
    const user = await getSessionUser(req);
    if (!user) return error(res, 401, 'unauthorized');

    if (req.method === 'GET') return handleGet(req, res, user);
    if (req.method === 'POST') return handlePost(req, res, user);
    if (req.method === 'DELETE') return handleDelete(req, res, user);
    
    return method(req, res, ['GET', 'POST', 'DELETE']);
});

async function handleGet(req, res, user) {
    const [wallet] = await sql`
        SELECT address, chain FROM agent_payout_wallets WHERE user_id = ${user.id} AND chain = 'solana' LIMIT 1
    `;
    return json(res, 200, { wallet: wallet || null });
}

async function handlePost(req, res, user) {
    const { address, chain = 'solana' } = await readJson(req);
    if (chain !== 'solana') return error(res, 400, 'validation_error', 'Only "solana" chain is supported.');
    
    // Validate Solana address
    try {
        new PublicKey(address);
    } catch {
        return error(res, 400, 'validation_error', 'Invalid Solana address format.');
    }

    const [wallet] = await sql`
        INSERT INTO agent_payout_wallets (user_id, address, chain, is_default)
        VALUES (${user.id}, ${address}, ${chain}, true)
        ON CONFLICT (user_id, chain) DO UPDATE SET address = EXCLUDED.address
        RETURNING address, chain
    `;
    return json(res, 200, { wallet });
}

async function handleDelete(req, res, user) {
    const { chain = 'solana' } = await readJson(req).catch(() => ({}));
    await sql`
        DELETE FROM agent_payout_wallets WHERE user_id = ${user.id} AND chain = ${chain}
    `;
    return json(res, 200, { success: true });
}
```
