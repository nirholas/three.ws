# Prompt 22: Backend for Payouts

## Objective
Create the backend infrastructure to process creator payout requests, batch earnings, and prepare the on-chain transaction.

## Explanation
This is the core of the payout system. The backend will be responsible for securely gathering all of a creator's unpaid earnings, marking them as "in-progress," and constructing a single Solana transaction to transfer the total amount to the creator's designated wallet.

## Instructions
1.  **Create API Route for Payout Request:**
    *   Set up the endpoint `POST /api/dashboard/request-payout`.
    *   This endpoint must be authenticated.

2.  **Implement Payout Logic:**
    *   **a. Get User and Settings:** Get the authenticated `user` and fetch their saved `payout_address` from the database. If no address is set, return a `400 Bad Request` error.
    *   **b. Lock Earnings and Calculate Total:**
        *   Start a database transaction.
        *   Find all records in `skill_payment_earnings` for this `creator_id` where `payout_id` is `NULL`.
        *   If there are no such earnings, return an error.
        *   Calculate the `total_net_amount` to be paid out. For simplicity, we'll assume a single currency (USDC) for now.
    *   **c. Create Payout Record:**
        *   Create a new record in the `payouts` table with a `pending` status, the `creator_id`, the `total_net_amount`, and the `destination_address`. Store the `payoutId`.
    *   **d. Associate Earnings with Payout:**
        *   Update all the earnings records you found in the previous step, setting their `payout_id` to the new `payoutId`. This "locks" them and prevents them from being included in future payouts.
    *   **e. Commit Transaction:** Commit the database transaction.
    *   **f. Process the Payout (Asynchronously):**
        *   The actual on-chain transaction should be handled by a separate, asynchronous process or queue. For this prompt, we can simulate it in a `setTimeout`.
        *   This background job will:
            1.  Construct the `spl-token` transfer transaction from a platform-owned treasury/hot wallet to the creator's `payout_address`.
            2.  Sign the transaction with the treasury wallet's key (this key must be securely stored on the server).
            3.  Send and confirm the transaction.
            4.  Update the `payouts` record with the `completed` status and the `tx_signature`.
    *   **g. Respond to Client:** Immediately after committing the DB transaction (step e), respond to the client with a success message. Do *not* wait for the on-chain part to finish.

## Code Example (Backend - `/api/dashboard/request-payout.js`)

```javascript
// --- Inside your API handler ---

const user = await getAuthenticatedUser(req);

// a. Get user and settings
const payoutSettings = await db.getPayoutSettings(user.id);
if (!payoutSettings?.payout_address) {
  return res.status(400).json({ error: 'Payout address not configured.' });
}

let payoutId;
try {
  // b., c., d. Transactional logic
  await db.transaction(async (trx) => {
    const earningsToPay = await trx('skill_payment_earnings')
      .where({ creator_id: user.id, payout_id: null })
      .select('id', 'net_amount');

    if (earningsToPay.length === 0) {
      throw new Error('No withdrawable balance.');
    }

    const totalNetAmount = earningsToPay.reduce((sum, e) => sum + e.net_amount, 0);
    const currencyMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // Assume USDC

    // c. Create Payout Record
    const [newPayout] = await trx('payouts')
      .insert({
        creator_id: user.id,
        amount: totalNetAmount,
        currency_mint: currencyMint,
        destination_address: payoutSettings.payout_address,
        status: 'pending',
      })
      .returning('id');
    payoutId = newPayout.id;

    // d. Associate Earnings
    const earningIds = earningsToPay.map(e => e.id);
    await trx('skill_payment_earnings')
      .whereIn('id', earningIds)
      .update({ payout_id: payoutId });
  });

} catch (error) {
  return res.status(400).json({ error: error.message });
}

// f. Trigger async payout processing
// DO NOT await this. This should be handled by a background worker queue (e.g., BullMQ, Celery).
// We simulate with a timeout for this example.
processPayout(payoutId); 

// g. Respond to client immediately
res.status(202).json({ message: 'Payout initiated.', payoutId });


// --- In a separate background worker file ---
async function processPayout(payoutId) {
    // Fetch payout details, create/sign/send transaction, update status to 'completed'.
    // This part is complex and involves secure key management for the treasury wallet.
}
```
