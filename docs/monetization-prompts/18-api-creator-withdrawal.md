# Prompt 18: API Endpoint for Creator Withdrawal Request

## Objective
Create a secure API endpoint that allows a creator to request a withdrawal of their available earnings balance.

## Explanation
This endpoint is the first step in the payout process. It allows a creator to formally request a withdrawal. The system will validate the request, create a payout record with a 'requested' status, and deduct the amount from their withdrawable balance. A separate background process will handle the actual on-chain transaction.

## Instructions
1.  **Create the API File:**
    *   Create a new API endpoint, e.g., `api/dashboard/request-withdrawal.js`.

2.  **Implement the `POST` Handler:**
    *   **Authentication:** Get the logged-in user.
    *   **Input Validation:** Expect an `amount` in the request body.
    *   **Fetch Balance:** Get the creator's current balance from the `creator_balances` table.
    *   **Validate Request:**
        *   Ensure the requested `amount` is greater than zero and not more than their available balance.
        *   Ensure the user has a destination wallet address configured in their profile.
    *   **Database Transaction:**
        *   Start a database transaction to ensure atomicity.
        *   **Decrement Balance:** Subtract the `amount` from the `creator_balances` table.
        *   **Create Payout Record:** Insert a new row into the `creator_payouts` table with `status = 'requested'`.
        *   Commit the transaction.
    *   **Return Success:** Respond with a success message.

## Code Example (`api/dashboard/request-withdrawal.js`)

```javascript
import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { error, json, wrap } from '../_lib/http.js';

export default wrap(async (req, res) => {
  const user = await getSessionUser(req);
  if (!user) return error(res, 401, 'unauthorized');

  const { amount } = await req.json();
  // TODO: Fetch user's configured destination wallet
  const destinationAddress = '...'; 

  if (!amount || amount <= 0) return error(res, 400, 'invalid_amount');

  try {
    await sql.begin(async sql => {
      const [balance] = await sql`
        SELECT balance, currency_mint FROM creator_balances WHERE user_id = ${user.id} FOR UPDATE
      `;

      if (!balance || balance.balance < amount) {
        throw new Error('Insufficient funds');
      }

      await sql`
        UPDATE creator_balances SET balance = balance - ${amount} WHERE user_id = ${user.id}
      `;

      await sql`
        INSERT INTO creator_payouts (user_id, amount, currency_mint, destination_address, status)
        VALUES (${user.id}, ${amount}, ${balance.currency_mint}, ${destinationAddress}, 'requested')
      `;
    });
  } catch (e) {
    return error(res, 400, 'transaction_failed', e.message);
  }

  return json(res, { success: true, message: 'Withdrawal requested.' });
});
```
