---
status: not-started
---

# Prompt 15: Backend - API Billing and Subscriptions

## Objective
Integrate a payment provider like Stripe to manage recurring subscriptions for API access.

## Explanation
This task turns API usage into a revenue stream. It involves setting up subscription plans, creating a secure checkout process for users to subscribe, and using webhooks to keep your application's state in sync with the billing provider.

## Instructions
1.  **Set Up Stripe Account and Products:**
    *   In your Stripe dashboard, create new products for your API plans (e.g., "Developer Plan", "Business Plan").
    *   Define the pricing for each plan (e.g., $49/month) and set usage limits (e.g., 100,000 API calls/month).

2.  **Create a `subscriptions` Table:**
    *   In your database, create a table to track user subscriptions.
    *   Columns: `id`, `user_id`, `stripe_subscription_id` (unique), `stripe_customer_id`, `plan_name`, `status` (e.g., `active`, `canceled`, `past_due`), `current_period_end`.

3.  **Implement Stripe Checkout Endpoint:**
    *   Create an API endpoint (e.g., `/api/billing/create-checkout-session`).
    *   This endpoint, using the Stripe Node.js library, will create a new Checkout Session for a specific plan.
    *   It should associate the session with a Stripe Customer ID (creating one if the user doesn't have one yet).
    *   Return the `sessionId` to the frontend, which will redirect the user to the Stripe-hosted checkout page.

4.  **Implement Stripe Webhook Handler:**
    *   Create a webhook endpoint (e.g., `/api/billing/webhook`) to receive events from Stripe.
    *   **Crucially, verify the webhook signature** to ensure the request is from Stripe.
    *   Handle key events:
        *   `checkout.session.completed`: A user has successfully subscribed. Use the data from this event to create a new record in your `subscriptions` table.
        *   `invoice.payment_succeeded`: A recurring payment was successful. Update the `current_period_end` in your database.
        *   `customer.subscription.deleted`: The user has canceled. Update the subscription `status` in your database.

5.  **Link Subscriptions to API Access:**
    *   In your API usage tracking middleware, before allowing an API call, check the user's subscription status in your database. If they have no active subscription or are over their usage limit, return a `403 Forbidden` or `429 Too Many Requests` error.

## Webhook Handler Snippet

```javascript
// POST /api/billing/webhook
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// ... (inside the handler, after reading the raw body)
let event;
try {
  event = stripe.webhooks.constructEvent(
    rawBody,
    req.headers['stripe-signature'],
    process.env.STRIPE_WEBHOOK_SECRET
  );
} catch (err) {
  return res.status(400).send(`Webhook Error: ${err.message}`);
}

switch (event.type) {
  case 'checkout.session.completed':
    const session = event.data.object;
    // ... create subscription in your DB
    break;
  case 'customer.subscription.updated':
  case 'customer.subscription.deleted':
    const subscription = event.data.object;
    // ... update subscription status in your DB
    break;
  // ... other events
}

res.status(200).json({ received: true });
```
