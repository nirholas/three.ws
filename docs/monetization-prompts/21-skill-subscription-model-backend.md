---
status: not-started
---

# Prompt 21: Skill Subscription Model - Backend

## Objective
Implement the backend infrastructure for a subscription model, where users pay a recurring fee for access to all of an agent's paid skills.

## Explanation
Subscriptions provide predictable revenue for creators and value for active users. This is a significant feature requiring new database tables and logic for managing subscription status and recurring payments. We'll focus on the backend setup first. For payments, we could use a service like Helio to manage recurring Solana payments.

## Instructions
- [ ] **Database Schema Changes:**
    - [ ] Create a new table: `agent_subscriptions`.
    - [ ] Columns: `id`, `user_id`, `agent_id`, `status` (e.g., 'active', 'cancelled', 'past_due'), `expires_at` (Timestamp), `payment_provider_subscription_id` (String).
    - [ ] Add a new table `agent_subscription_plans`: `id`, `agent_id`, `amount`, `currency_mint`, `interval` (e.g., 'month', 'year').

- [ ] **API for Subscription Plans:**
    - [ ] Create CRUD APIs for creators to manage their subscription plans (`/api/agents/:id/subscription-plans`). A creator might offer monthly and yearly tiers.

- [ ] **API for Creating a Subscription:**
    - [ ] Create an endpoint `POST /api/subscriptions/create`.
    - [ ] This endpoint would interact with a recurring payment provider (e.g., Helio). It would create a payment link or subscription plan with the provider and return it to the frontend.

- [ ] **Webhook for Payment Events:**
    - [ ] Create a webhook endpoint `POST /api/webhooks/payments`.
    - [ ] The payment provider will call this webhook to notify your app of events like `subscription.created`, `subscription.payment_succeeded`, `subscription.payment_failed`.
    - [ ] When a `payment_succeeded` event is received, you should:
        - [ ] Find the corresponding subscription in your `agent_subscriptions` table.
        - [ ] Update its `status` to 'active'.
        - [ ] Set the `expires_at` to the end of the new billing period (e.g., now + 30 days).

- [ ] **Update Skill Gating Logic:**
    - [ ] Modify the skill gating logic from Prompt 19.
    - [ ] Before checking for individual skill ownership in `unlocked_skills`, it should first check for an active subscription.
    - [ ] Query the `agent_subscriptions` table for the `user_id` and `agent_id`. If an active subscription exists (`status` = 'active' and `expires_at` > now), allow skill execution.

## Webhook Logic Example

```javascript
// POST /api/webhooks/payments
export default async function handler(req, res) {
    // 1. Verify the webhook signature to ensure it's from the payment provider
    if (!isSignatureValid(req)) {
        return res.status(403).send('Invalid signature');
    }
    
    const event = req.body;

    // 2. Handle the event
    switch (event.type) {
        case 'subscription.payment_succeeded':
            const subId = event.data.subscription_id;
            const newExpiry = new Date(event.data.new_expiry_timestamp);
            
            // Find subscription in DB by payment_provider_subscription_id
            await db.updateSubscriptionStatus(subId, 'active', newExpiry);
            break;
        case 'subscription.payment_failed':
            // ... handle failed payments, maybe set status to 'past_due'
            break;
    }

    // 3. Acknowledge receipt
    res.status(200).send('Acknowledged');
}
```
