# Prompt 14: Grant Skill Access After Payment

## Objective
Integrate the logic for creating a `skill_access_grants` record into the payment confirmation flow.

## Explanation
This prompt links the successful payment confirmation (Prompt 12) with the access grant system (Prompt 13). Once the backend has verified a user's payment on-chain, it must immediately create the corresponding access grant in the database.

## Instructions
1.  **File to Edit:**
    *   Open the backend endpoint for payment confirmation: `POST /api/payments/confirm-skill-payment`.

2.  **Integrate Grant Creation:**
    *   Locate the spot in your code immediately after the payment status has been successfully updated to `completed`.
    *   Before sending the final success response to the client, add a call to your database logic to insert a new row into the `skill_access_grants` table.

3.  **Determine Grant Rules:**
    *   You need to decide what kind of access this payment provides. For a simple one-time payment model, you could grant access for a fixed duration.
    *   **Example Rule:** Grant access for 24 hours from the time of purchase.
    *   To implement this, calculate the expiry timestamp.

4.  **Populate the Grant Record:**
    *   The new `skill_access_grants` row should be populated with:
        *   `user_id`: From the authenticated user session.
        *   `agent_id`, `skill_name`: From the `paymentIntent` record you fetched from the database.
        *   `payment_id`: The ID of the now-completed payment.
        *   `expires_at`: The calculated expiry timestamp (e.g., `Date.now() + 24 * 60 * 60 * 1000`).
        *   `uses_left`: `NULL` for this time-based model.

5.  **Transactional Integrity:**
    *   Ideally, the database operations for updating the payment status and creating the access grant should be wrapped in a database transaction. This ensures that either both operations succeed or both fail, preventing a state where a user pays but doesn't get access.

## Code Example (Backend - `confirm-skill-payment` logic)

This refines the example from Prompt 12.

```javascript
// Inside your /api/payments/confirm-skill-payment endpoint handler

// ... after successfully verifying the on-chain transaction ...

try {
  // Use a database transaction to ensure atomicity
  await db.transaction(async (trx) => {
    // c. Update Payment Status
    await trx.update('skill_payments', { status: 'completed', signature: signature })
      .where({ id: paymentId });
    
    // d. Grant Skill Access
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now
    
    await trx.insert({
      user_id: user.id,
      agent_id: paymentIntent.agentId,
      skill_name: paymentIntent.skillName,
      payment_id: paymentId,
      expires_at: expiresAt,
      uses_left: null, // This is a time-based grant
    }).into('skill_access_grants');
  });

  // e. Respond for frontend to continue
  res.status(200).json({ success: true, message: 'Payment confirmed and access granted.' });

} catch (error) {
  console.error('Error in confirmation transaction:', error);
  // The database transaction should automatically roll back on error
  res.status(500).json({ error: 'Failed to finalize payment.' });
}
```
