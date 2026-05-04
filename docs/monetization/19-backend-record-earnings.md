# Prompt 19: Backend Logic to Record Earnings

## Objective
After a payment is confirmed, implement the backend logic to calculate and record the creator's earnings and the platform fee in the `skill_payment_earnings` table.

## Explanation
This is the accounting step of the monetization flow. It connects the confirmed payment to the creator's ledger. This logic must run immediately after payment confirmation to ensure that revenue is tracked in real-time.

## Instructions
1.  **File to Edit:**
    *   Open the backend endpoint for payment confirmation: `POST /api/payments/confirm-skill-payment`.

2.  **Integrate Earnings Calculation:**
    *   Locate the spot in your code inside the database transaction, immediately after you have updated the `skill_payments` table to `completed` and created the `skill_access_grants` record.
    *   **Define Platform Fee:** Get the current platform fee. It's best practice to have this as a configurable value (e.g., in an environment variable or a configuration file). For example, `PLATFORM_FEE_BPS = 500` (for 5%).
    *   **Calculate Amounts:**
        *   `gross_amount`: This is the `amount` from the `paymentIntent` record.
        *   `platform_fee_amount`: `Math.floor(gross_amount * PLATFORM_FEE_BPS / 10000)`. Use floor to be safe.
        *   `net_amount`: `gross_amount - platform_fee_amount`.
    *   **Get Creator ID:** You'll need the ID of the agent's creator, which should be available on the `agent` object.

3.  **Insert the Earnings Record:**
    *   Within the same database transaction, insert a new row into the `skill_payment_earnings` table with all the calculated values.

## Code Example (Backend - `confirm-skill-payment` logic)

This refines the example from Prompt 14, adding the earnings logic to the transaction.

```javascript
// Inside your /api/payments/confirm-skill-payment endpoint handler

// ... after successfully verifying the on-chain transaction ...

const PLATFORM_FEE_BPS = 500; // 5%

try {
  // Use a database transaction to ensure atomicity
  await db.transaction(async (trx) => {
    // 1. Update Payment Status
    await trx.update('skill_payments', { status: 'completed', signature: signature })
      .where({ id: paymentId });
    
    // 2. Grant Skill Access
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await trx.insert({
      user_id: user.id,
      agent_id: paymentIntent.agentId,
      skill_name: paymentIntent.skillName,
      payment_id: paymentId,
      expires_at: expiresAt,
    }).into('skill_access_grants');

    // 3. NEW: Record Earnings
    const agent = await trx.select('creator_id').from('agents').where({ id: paymentIntent.agentId }).first();
    const gross_amount = paymentIntent.amount;
    const platform_fee_amount = Math.floor(gross_amount * PLATFORM_FEE_BPS / 10000);
    const net_amount = gross_amount - platform_fee_amount;

    await trx.insert({
        payment_id: paymentId,
        agent_id: paymentIntent.agentId,
        creator_id: agent.creator_id,
        gross_amount,
        platform_fee_bps: PLATFORM_FEE_BPS,
        platform_fee_amount,
        net_amount,
        currency_mint: paymentIntent.currency_mint,
    }).into('skill_payment_earnings');
  });

  res.status(200).json({ success: true, message: 'Payment confirmed and access granted.' });

} catch (error) {
  console.error('Error in confirmation transaction:', error);
  res.status(500).json({ error: 'Failed to finalize payment.' });
}
```
