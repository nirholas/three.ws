# Prompt 16: User Subscription Flow

## Objective
Implement the frontend and backend logic for users to subscribe to an agent's subscription tier.

## Explanation
This task combines previous concepts (wallet connection, transaction creation, verification) into a subscription context. The user will select a subscription tier, approve a transaction for the first payment, and the backend will create a record in the `user_subscriptions` table to mark the subscription as active. This prompt will not cover recurring payments, but will set up the initial subscription.

## Instructions
1.  **Update Marketplace UI:**
    *   In `src/marketplace.js`, when rendering the agent detail page, fetch and display the available subscription tiers.
    *   Each tier should have a "Subscribe" button.

2.  **Subscription Confirmation Modal:**
    *   Clicking "Subscribe" should open a confirmation modal, similar to the one-time purchase, showing the tier name, price, and billing cycle.

3.  **Backend Subscription Endpoint:**
    *   Create an endpoint `/api/subscriptions/subscribe`.
    *   It takes `tierId` and the user's public key.
    *   It constructs and returns a transaction for the first payment, just like the one-time purchase.

4.  **Frontend Transaction Handling:**
    *   The frontend gets the transaction, has the user sign and send it.

5.  **Backend Verification and Activation Endpoint:**
    *   Create an endpoint `/api/subscriptions/verify`.
    *   It takes a `transactionSignature` and `tierId`.
    *   It verifies the transaction on-chain.
    *   If valid, it creates a new record in the `user_subscriptions` table with a status of 'active'. It calculates `current_period_start` (now) and `current_period_end` (e.g., now + 1 month).

## Code Example (`api/subscriptions/verify.js`)

```javascript
import { supabase } from '../../_lib/supabase';
import { json, error } from '../../_lib/http';
import { getAuthUser } from '../../_lib/auth';

export default async function handler(req, res) {
    const { transactionSignature, tierId } = req.body;
    const user = await getAuthUser(req);

    if (!user) return error(res, 401, 'Unauthorized');

    // 1. Verify transaction on-chain (similar to prompt #6)
    const isTxValid = await verifySubscriptionPayment(transactionSignature, tierId, user.id);
    if (!isTxValid) {
        return error(res, 400, 'Invalid transaction.');
    }

    // 2. Get tier details to calculate the period end
    const { data: tier } = await supabase.from('agent_subscription_tiers').select('billing_interval').eq('id', tierId).single();
    if (!tier) {
        return error(res, 404, 'Subscription tier not found.');
    }
    
    // 3. Create the subscription record
    const startDate = new Date();
    const endDate = new Date(startDate);
    if (tier.billing_interval === 'month') {
        endDate.setMonth(startDate.getMonth() + 1);
    } else if (tier.billing_interval === 'year') {
        endDate.setFullYear(startDate.getFullYear() + 1);
    }

    const { error: insertError } = await supabase
        .from('user_subscriptions')
        .insert({
            user_id: user.id,
            tier_id: tierId,
            status: 'active',
            current_period_start: startDate.toISOString(),
            current_period_end: endDate.toISOString(),
            // `transaction_signature` might be stored on a related `payments` table
        });

    if (insertError) {
        return error(res, 500, 'Failed to activate subscription.');
    }

    return json(res, { success: true, message: 'Subscription activated!' });
}
```
