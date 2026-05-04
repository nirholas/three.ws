# Prompt 22: Withdrawal API

## Objective
Create a backend API endpoint that allows a creator to request a withdrawal of their available balance to their configured payout wallet.

## Explanation
The final step in the money-out flow is the withdrawal. A creator with a positive balance and a configured payout wallet should be able to request a payout. This API will not perform the transfer instantly. Instead, it will log the request in a new `agent_withdrawals` table with a 'pending' status. A separate process (manual for now, but could be a cron job later) would then execute the on-chain transfers and update the status.

## Instructions
1.  **Create a New API File:**
    *   Create `/api/billing/withdraw.js`.

2.  **Define the Endpoint Logic:**
    *   The `POST` endpoint must be authenticated.
    *   It does not need a request body; it should attempt to withdraw the user's *entire* available balance.

3.  **Implement Core Logic:**
    *   **Get Balance and Wallet:** In a single transaction for consistency (`BEGIN`/`COMMIT`):
        *   Calculate the user's current balance by summing `net_amount` from `agent_revenue_events` and subtracting the sum of `amount` from `agent_withdrawals` (for 'pending' or 'completed' requests).
        *   Fetch the user's configured payout wallet from `agent_payout_wallets`.
    *   **Validate:**
        *   If the balance is zero or less, return an error.
        *   If the payout wallet is not configured, return an error.
    *   **Create Withdrawal Record:**
        *   If validation passes, `INSERT` a new row into the `agent_withdrawals` table.
        *   The row should contain the `user_id`, the calculated `amount` (the entire balance), the `currency_mint` (USDC), the `chain` (Solana), the `to_address` from their payout wallet, and a `status` of 'pending'.
    *   **Return Success:**
        *   Return a 201 status with a success message indicating that the withdrawal request has been submitted.

## Code Example (Backend - `/api/billing/withdraw.js`)

```javascript
import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { cors, json, method, wrap, error } from '../_lib/http.js';

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyB7u6a';

export default wrap(async (req, res) => {
    if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
    if (!method(req, res, ['POST'])) return;
    
    const user = await getSessionUser(req);
    if (!user) return error(res, 401, 'unauthorized');

    try {
        const [result] = await sql.transaction(async (tx) => {
            // Get Payout Wallet
            const [wallet] = await tx`
                SELECT address FROM agent_payout_wallets WHERE user_id = ${user.id} AND chain = 'solana' LIMIT 1
            `;
            if (!wallet) throw new Error('Payout wallet not configured.');

            // Calculate available balance
            const [revenue] = await tx`
                SELECT SUM(rev.net_amount) as total_earned
                FROM agent_revenue_events rev JOIN agent_identities ai ON rev.agent_id = ai.id
                WHERE ai.user_id = ${user.id}
            `;
            const [withdrawn] = await tx`
                SELECT SUM(amount) as total_withdrawn
                FROM agent_withdrawals
                WHERE user_id = ${user.id} AND status IN ('pending', 'completed')
            `;
            const balance = BigInt(revenue.total_earned || 0) - BigInt(withdrawn.total_withdrawn || 0);
            
            if (balance <= 0) throw new Error('Insufficient balance to withdraw.');

            // Insert pending withdrawal record
            const [withdrawal] = await tx`
                INSERT INTO agent_withdrawals (user_id, amount, currency_mint, chain, to_address, status)
                VALUES (${user.id}, ${balance}, ${USDC_MINT}, 'solana', ${wallet.address}, 'pending')
                RETURNING id, amount, created_at
            `;
            return withdrawal;
        });

        return json(res, 201, {
            message: `Withdrawal request for ${Number(result.amount) / 1e6} USDC submitted successfully.`,
            withdrawal_id: result.id,
        });

    } catch (e) {
        return error(res, 400, 'withdrawal_error', e.message);
    }
});
```
