# Prompt 22: Skill Subscription Model - Frontend

## Objective
Create the user interface for users to discover, purchase, and manage subscriptions to agents.

## Explanation
Following the backend setup, the frontend needs to present subscription options to users on the agent detail page and provide a way for them to manage their active subscriptions.

## Instructions
1.  **Display Subscription Plans on Agent Page:**
    *   On the agent detail page (`marketplace.html`), add a new section for subscriptions.
    *   Fetch the agent's available subscription plans from the API (`GET /api/agents/:id/subscription-plans`).
    *   Display the plans with their price and billing interval (e.g., "$10 / month").
    *   Add a "Subscribe" button for each plan.

2.  **Subscription Purchase Flow:**
    *   When a user clicks "Subscribe", make a request to the backend `POST /api/subscriptions/create` endpoint.
    *   The backend will respond with a URL to the payment provider's checkout page (e.g., a Helio payment link).
    *   Redirect the user to this URL to complete the payment and set up the recurring transaction.
    *   The payment provider will handle the redirect back to your site.

3.  **UI State for Subscribed Users:**
    *   When viewing an agent to whom the user is subscribed, the UI should reflect this.
    *   Instead of "Subscribe", show "You are Subscribed".
    *   All paid skills for that agent should automatically appear as "Unlocked". The skill gating logic on the backend will already handle access.

4.  **Subscription Management Page:**
    *   Create a new "My Subscriptions" page for logged-in users.
    *   This page will list all their active subscriptions.
    *   For each subscription, it should show the agent, the price, and the next renewal date.
    *   Include a "Manage" or "Cancel" button. This would typically link to the customer portal provided by the payment service (like Helio or Stripe) where users can manage their payment methods and cancellations.

## JavaScript Example (Subscribe Button Click)

```javascript
// On agent detail page, for a "Subscribe" button
subscribeButton.addEventListener('click', async () => {
    try {
        const response = await fetch('/api/subscriptions/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ planId: selectedPlan.id })
        });

        if (!response.ok) throw new Error('Could not create subscription.');

        const { checkoutUrl } = await response.json();

        // Redirect user to the payment page
        window.location.href = checkoutUrl;

    } catch (error) {
        console.error('Subscription failed:', error);
        alert('Failed to initiate subscription.');
    }
});
```
