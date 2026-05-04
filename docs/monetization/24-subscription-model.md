# Prompt 24: Subscription Pricing Model for Skills

## Objective
Extend the monetization system to support a subscription model, where a user pays a recurring fee for access to all of an agent's paid skills.

## Explanation
A one-time payment per skill is a good start, but subscriptions offer creators a predictable revenue stream and users a more convenient way to access a suite of premium skills. This prompt covers the necessary database and backend changes to introduce a subscription option.

## Instructions
1.  **Database Schema Changes:**
    *   **`agents` table:** Add columns to the `agents` table (or a new `agent_subscriptions` table) to store subscription pricing:
        *   `subscription_amount` (BIGINT)
        *   `subscription_interval` (VARCHAR, e.g., 'month')
        *   `subscription_currency_mint` (VARCHAR)
    *   **`user_agent_subscriptions` table:** Create a new table to track active user subscriptions.
        *   `id`: Primary key.
        *   `user_id`: Foreign key to `users`.
        *   `agent_id`: Foreign key to `agents`.
        *   `status`: VARCHAR (e.g., 'active', 'cancelled', 'past_due').
        *   `current_period_ends_at`: TIMESTAMPTZ.
        *   `created_at`, `updated_at`.

2.  **UI for Creators:**
    *   In `agent-edit.html`, under the new "Earnings" or a dedicated "Monetization" tab, add a form for creators to enable and configure subscriptions for their agent.
    *   This includes inputs for price, currency, and interval (e.g., a dropdown for "monthly").

3.  **Modify Skill Access Check:**
    *   Update the `checkForValidSkillGrant` logic (from Prompt 15).
    *   Before checking for individual skill grants in `skill_access_grants`, it must **first** check if the user has an `active` subscription to the agent in the `user_agent_subscriptions` table where `current_period_ends_at` is in the future.
    *   If an active subscription exists, the check should immediately return `true`, granting access to all of the agent's skills.

4.  **Subscription Payment Flow:**
    *   Create a new "Subscribe" button on the agent's detail page in the marketplace.
    *   This will trigger a new payment flow, similar to the single-skill payment:
        *   A new "prepare subscription" endpoint that creates a transaction for the subscription amount.
        *   A "confirm subscription" endpoint that verifies the payment and creates the initial record in `user_agent_subscriptions`.

5.  **Recurring Billing (Advanced):**
    *   True recurring billing on Solana is complex. For this prompt, the focus is on a manual renewal model. The user's subscription is valid until `current_period_ends_at`.
    *   A separate, more advanced feature would involve setting up a cron job or on-chain program to handle automatic renewals.

## Code Example (Backend - Skill Access Check Logic)

```javascript
// The updated access check logic

async function checkForAccess({ userId, agentId, skillName }) {
  // 1. Check for an active agent-level subscription first
  const activeSubscription = await db('user_agent_subscriptions')
    .where({
      user_id: userId,
      agent_id: agentId,
      status: 'active',
    })
    .where('current_period_ends_at', '>', db.fn.now())
    .first();

  if (activeSubscription) {
    return true; // Subscription grants access to all skills
  }

  // 2. If no subscription, check for a specific, single-skill grant
  const skillGrant = await db('skill_access_grants')
    .where({
      user_id: userId,
      agent_id: agentId,
      skill_name: skillName,
    })
    .where(builder => {
      builder.where('expires_at', '>', db.fn.now())
             .orWhere('uses_left', '>', 0);
    })
    .first();
    
  if (skillGrant) {
    // Decrement uses_left if applicable (as in Prompt 15)
    return true;
  }

  return false;
}
```
