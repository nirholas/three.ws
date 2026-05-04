---
status: not-started
---

# Prompt 24: Frontend - Subscription Management UI

## Objective
Create a user interface that allows developers to manage their API subscriptions, including upgrading, downgrading, and canceling plans.

## Explanation
A self-service subscription management portal is essential for a smooth developer experience and for reducing customer support load. This UI will typically link out to a secure, pre-built portal hosted by your payment provider (like Stripe), where users can manage their payment methods and subscription status directly.

## Instructions
1.  **Backend - Create Stripe Customer Portal Endpoint:**
    *   Create a new backend API endpoint, e.g., `/api/billing/create-portal-session`.
    *   This endpoint will use the Stripe Node.js SDK.
    *   It should authenticate the user to get their `user_id`.
    *   It will look up the user's `stripe_customer_id` from your `subscriptions` or `users` table.
    *   It then calls `stripe.billingPortal.sessions.create()` to generate a unique, single-use URL for that customer's portal.
    *   The endpoint returns this URL to the frontend.

2.  **Frontend - Add a "Manage Subscription" Page/Section:**
    *   On your `api-keys.html` page, or a new `billing.html` page, create a new section called "Subscription Status".
    *   Display the user's current plan name (e.g., "Developer Plan") and the status (e.g., "Active"). You will get this from your own database via an endpoint.
    *   Add a prominent button labeled "Manage Billing & Subscription".

3.  **Frontend - Implement the Button Logic:**
    *   In the JavaScript for this page, add a click handler to the "Manage" button.
    *   When clicked, it should make a `POST` request to your new `/api/billing/create-portal-session` endpoint.
    *   The API will respond with a JSON object containing the portal URL.
    *   The frontend should then redirect the user to this URL: `window.location.href = data.url;`.

4.  **Configure the Stripe Customer Portal:**
    *   In your Stripe dashboard, go to the Customer Portal settings.
    *   Configure which actions you want to allow users to perform (e.g., update payment methods, view invoice history, change plans, cancel subscriptions).
    *   Set the redirect URL to bring users back to your application after they are done.

## Backend Endpoint Example

```javascript
// POST /api/billing/create-portal-session
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

export default wrap(async (req, res) => {
  const user = await getSessionUser(req);
  if (!user) return error(res, 401);

  // 1. Fetch the user's Stripe Customer ID from your database
  const [sub] = await sql`
    SELECT stripe_customer_id FROM subscriptions WHERE user_id = ${user.id} AND status = 'active'
  `;
  if (!sub || !sub.stripe_customer_id) {
    return error(res, 404, 'not_found', 'No active subscription found.');
  }

  // 2. Create the portal session
  const portalSession = await stripe.billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    return_url: `${process.env.APP_ORIGIN}/api-keys`, // URL to return to
  });

  // 3. Return the URL for redirect
  return json(res, 200, { url: portalSession.url });
});
```
