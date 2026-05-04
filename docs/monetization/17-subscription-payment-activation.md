---
status: not-started
---

# Prompt 17: Subscription Payment and Activation

## Objective
Implement the backend and frontend logic to handle a new subscription payment using Solana Pay and activate the subscription in the database.

## Explanation
This process is similar to a one-time skill purchase but involves creating a `user_subscriptions` record instead. For simplicity in this initial implementation, we will treat the first subscription payment as a one-time charge. True recurring payments on Solana are more complex and can be implemented later.

## Instructions
1.  **Create a Subscription Transaction Endpoint:**
    *   Create a new backend endpoint, e.g., `GET /api/subscribe/transaction?tierId=...`.
    *   This endpoint will be called when a user clicks a "Subscribe" button.
    *   It should look up the tier details (price, currency) from the `agent_subscription_tiers` table.
    *   Generate a `reference` keypair for tracking this specific subscription activation.
    *   Before returning the transaction URL, it should create a new record in the `user_subscriptions` table with a status of `'incomplete'` and store the `reference` key. This "locks in" the intent to subscribe.

2.  **Create the Solana Pay Details Endpoint:**
    *   Similar to the one-time purchase, create the `POST /api/subscribe/details` endpoint that the wallet will call.
    *   This endpoint should build and serialize a transaction to transfer the correct subscription price from the user's wallet to the agent owner's wallet.

3.  **Create a Subscription Verification Endpoint:**
    *   Create an endpoint like `GET /api/subscribe/status?reference=...`.
    *   This endpoint will be polled by the frontend after the user is shown the QR code.
    *   Its logic should:
        *   Find the transaction using the `reference` public key.
        *   Thoroughly validate the transaction details (amount, recipient, etc.).
        *   If valid, find the `'incomplete'` record in `user_subscriptions` associated with this `reference`.
        *   Update the record's status to `'active'`.
        *   Set the `current_period_start` to `NOW()` and `current_period_end` to the appropriate future date (e.g., 1 month from now).
        *   Store the transaction signature.
        *   Return `{ status: 'confirmed' }` to the frontend.

4.  **Update Frontend Logic:**
    *   The `initiateSubscription('tierId')` function should call the `/api/subscribe/transaction` endpoint.
    *   It should then display the QR code and start polling the `/api/subscribe/status` endpoint.
    *   Upon confirmation, it should refresh the UI to show the user's new "Current Plan".

## Key Difference from One-Time Purchase
The main difference is the database interaction. Instead of inserting into `user_unlocked_skills`, we are creating and then updating a record in `user_subscriptions`. This sets the foundation for managing the subscription lifecycle (renewals, cancellations, etc.) in the future.

## Code Example (Backend - Creating 'incomplete' subscription)

```javascript
// Inside GET /api/subscribe/transaction
// ... after fetching tier details
const reference = new solanaWeb3.Keypair();
const userId = await getUserIdFromRequest(req);

// Create an initial record to track this attempt
const subResult = await db.query(
  `INSERT INTO user_subscriptions (user_id, tier_id, status, payment_reference)
   VALUES ($1, $2, 'incomplete', $3) RETURNING id`,
  [userId, tierId, reference.publicKey.toBase58()]
);
const subscriptionId = subResult.rows[0].id;

// Now construct the Solana Pay URL, perhaps including the subscriptionId for context
const url = new URL(`${req.protocol}://${req.get('host')}/api/subscribe/details`);
url.searchParams.set('subId', subscriptionId); // Pass the new ID to the details endpoint

const solanaPayUrl = `solana:${encodeURIComponent(url.toString())}`;
res.json({ url: solanaPayUrl, reference: reference.publicKey.toBase58() });
```
