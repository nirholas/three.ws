# Prompt 12: Backend Endpoint to Confirm Payment

## Objective
Create a backend endpoint to confirm that a user's on-chain payment was successful, and then trigger the logic to grant them access to the skill.

## Explanation
After the user signs and sends the transaction, the frontend informs the backend. The backend must then verify on-chain that the transaction was successful and matches the expected payment details. This server-side confirmation is a crucial security step to prevent fraudulent access claims.

## Instructions
1.  **Create API Route:**
    *   Set up a new endpoint: `POST /api/payments/confirm-skill-payment`.
    *   This endpoint must be authenticated.

2.  **Request Body:**
    *   The endpoint should accept `paymentId` (from the prepare step) and the `signature` of the confirmed transaction.

3.  **Backend Logic:**
    *   **a. Retrieve Payment Intent:** Use the `paymentId` to fetch the `pending` payment record from your `skill_payments` table. If not found or not pending, return an error. Verify that the payment intent belongs to the authenticated user.
    *   **b. Fetch and Verify Transaction:**
        *   Use the `signature` to fetch the transaction details from the Solana cluster using `connection.getTransaction(signature)`.
        *   **Crucial Verifications:**
            *   Check that the transaction was successful (`err: null`).
            *   Parse the transaction's instructions. Find the `spl-token` transfer instruction.
            *   Verify the **source**, **destination**, and **amount** from the on-chain transaction match the details stored in your `skill_payments` record. This prevents users from submitting a signature for a different, unrelated transaction.
            *   Verify the transaction's blockhash or a stored reference to prevent replay attacks.
    *   **c. Update Payment Status:** If all verifications pass, update the `skill_payments` record status from `pending` to `completed`.
    *   **d. Grant Skill Access:** Call the logic to create a record in the `skill_access_grants` table for this user and skill (to be fully implemented in a later prompt).
    *   **e. Re-trigger AI Flow:** The chat orchestrator should now re-process the original user message that was paused. Since the access grant now exists, the skill check (Prompt 8) will pass, and the skill will execute. The simplest way to do this is to have the `/confirm` endpoint return a success message, and the frontend, upon seeing this success, resubmits the original chat message.
    *   **f. Respond:** Return a `200 OK` success message.

## Code Example (Backend - `/api/payments/confirm-skill-payment.js`)

```javascript
// --- Inside your API handler ---

const { paymentId, signature } = req.body;
const user = await getAuthenticatedUser(req);

// a. Retrieve Payment Intent
const paymentIntent = await db.getPaymentIntent(paymentId);
if (!paymentIntent || paymentIntent.status !== 'pending' || paymentIntent.userId !== user.id) {
  return res.status(404).json({ error: 'Invalid or expired payment session.' });
}

try {
  // b. Fetch and Verify Transaction
  const connection = new Connection(process.env.SOLANA_RPC_URL);
  const tx = await connection.getTransaction(signature, { maxSupportedTransactionVersion: 0 });

  if (tx.meta.err) {
    throw new Error('Transaction failed on-chain.');
  }

  // Find the relevant token transfer instruction (this logic can be complex)
  // You may need a helper to parse instructions based on program ID
  const transferInstruction = findSplTransfer(tx.transaction.message.instructions);
  
  // A simplified check. In reality, you need to parse account keys from the message.
  const onChainAmount = transferInstruction.data.amount; 
  if (onChainAmount < paymentIntent.amount) {
      throw new Error('On-chain amount does not match expected amount.');
  }
  // ... more checks for source, destination, etc.

  // c. Update Payment Status
  await db.updatePaymentStatus(paymentId, 'completed', signature);
  
  // d. Grant Skill Access
  await db.createSkillAccessGrant({
    userId: user.id,
    agentId: paymentIntent.agentId,
    skillName: paymentIntent.skillName,
    // Define your access rules, e.g., expires in 24 hours
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), 
  });

  // e. Respond for frontend to continue
  res.status(200).json({ success: true, message: 'Payment confirmed.' });

} catch (error) {
  console.error('Confirmation error:', error);
  // Optionally update payment status to 'failed'
  await db.updatePaymentStatus(paymentId, 'failed');
  res.status(400).json({ error: 'Payment verification failed.', details: error.message });
}
```
