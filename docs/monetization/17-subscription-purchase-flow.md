# Prompt 17: Subscription Purchase Flow

## Objective
Implement the UI and backend logic for purchasing a monthly subscription to an agent, which grants access to all its skills.

## Explanation
This prompt builds on the subscription database schema by creating the user-facing flow to purchase a subscription. This will involve presenting subscription tiers, handling payment, and creating the `user_subscriptions` record.

## Instructions
1.  **Display Subscription Tiers:**
    *   On the agent detail page in the marketplace, if an agent offers subscriptions, display the available tiers (from the `subscription_tiers` table).
    *   Each tier should show its name, price, interval (e.g., "$10/month"), and description.
    *   Add a "Subscribe" button to each tier.

2.  **Create Subscription Checkout API:**
    *   Create a new endpoint, e.g., `/api/subscriptions/purchase`.
    *   This endpoint will handle the payment logic. Since subscriptions are recurring, a simple transfer is not enough. You need to use a Solana protocol designed for recurring payments, like Solana Pay or a custom smart contract.
    *   For this prompt, we can simulate the first payment: the endpoint should behave like the skill purchase endpoint, processing a one-time payment for the first month.

3.  **Create `user_subscriptions` Record:**
    *   After the first payment is successfully processed, the backend must:
        *   Create a new record in the `user_subscriptions` table.
        *   Set the `user_id`, `tier_id`, and `status` to 'active'.
        *   Set the `start_date` to the current time.
        *   Calculate and set the `end_date` (e.g., `start_date` + 1 month).

4.  **Connect UI to API:**
    *   Wire the "Subscribe" button to call the purchase endpoint and handle the transaction with the user's wallet.

## Note on Recurring Payments
True on-chain recurring payments are complex. They often require users to deposit funds into an escrow contract or use token streaming protocols. This prompt simplifies the task to focus on the initial purchase and record creation, which is the first step in any subscription system. A later, more advanced prompt would cover the on-chain automation for renewals.
