---
status: not-started
last_updated: 2026-05-04
---
# Prompt 22: Skill Subscriptions (Recurring Revenue)

## Objective
Introduce a subscription model for skills, allowing creators to earn recurring revenue. Users can subscribe to a skill for a monthly fee to maintain access.

## Explanation
One-time purchases are great, but subscriptions provide creators with a predictable income stream and encourage them to keep their skills updated. This is a significant architectural addition, requiring a system to manage subscription state and handle recurring payments. For Solana, we can't use traditional server-side billing, so we'll model it as a system of time-limited access tokens that the user must renew.

## Instructions
1.  **Database Schema for Subscriptions:**
    *   Create a `skill_subscriptions` table:
        *   `id`: Primary key.
        *   `user_id`, `agent_id`, `skill_name`: Foreign keys.
        *   `expires_at`: A timestamp indicating when the current subscription period ends.
        *   `status`: An enum (e.g., `'active'`, `'expired'`, `'cancelled'`).
        *   `last_payment_signature`: The signature of the latest renewal transaction.

2.  **Update UI for Price Setting:**
    *   In `agent-edit.html`, allow creators to specify a price as "one-time" or "monthly."
    *   If monthly, they set a monthly price. This gets stored in `agent_skill_prices` with a new column, e.g., `billing_interval: 'monthly'`.

3.  **Modify Purchase Flow:**
    *   When a user "subscribes," the purchase flow is the same as a one-time purchase.
    *   However, upon successful confirmation in `purchase-confirm`, a record is created in the `skill_subscriptions` table instead of `user_purchased_skills`. The `expires_at` is set to 30 days from now.

4.  **Update Access Control Logic:**
    *   The skill ownership check (`api/chat.js`) must now also check the `skill_subscriptions` table.
    *   If a user has an 'active' subscription and `expires_at` is in the future, they are granted access.
    *   If `expires_at` is in the past, their status should be considered 'expired', and they should be denied access.

5.  **Renewal UI:**
    *   In the marketplace UI, if a user has an expired subscription, the "Purchase" button should reappear as "Renew Subscription."
    *   Clicking it triggers the same purchase flow, which, upon confirmation, updates the `expires_at` timestamp for the existing subscription record.

## SQL Example (`skill_subscriptions` table)

```sql
CREATE TABLE IF NOT EXISTS skill_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
    skill_name VARCHAR(255) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'active', -- e.g., 'active', 'expired'
    last_payment_signature VARCHAR(128),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(user_id, agent_id, skill_name)
);
```
