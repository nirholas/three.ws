---
status: not-started
---

# Prompt 13: Subscription Tiers Database Schema

## Objective
Design and create the necessary database tables to support agent-specific subscription tiers.

## Explanation
To move beyond one-time purchases, we need a system for recurring subscriptions. This starts with a robust database schema that allows creators to define different subscription tiers for their agents, and for the system to track user subscriptions.

## Instructions
1.  **Create `agent_subscription_tiers` Table:**
    *   This table will store the different subscription plans offered by a creator for a specific agent.
    *   **Columns:**
        *   `id`: Primary key (e.g., UUID or SERIAL).
        *   `agent_id`: Foreign key to the `agents` table.
        *   `name`: The name of the tier (e.g., "Supporter", "Pro").
        *   `description`: A short description of the tier's benefits.
        *   `price_amount`: The recurring price in the smallest unit (e.g., lamports).
        *   `price_currency_mint`: The currency of the price.
        *   `interval`: The billing cycle (e.g., 'day', 'week', 'month', 'year').
        *   `interval_count`: The number of intervals per cycle (e.g., 1 for monthly, 3 for quarterly).
        *   `active`: A boolean to allow creators to enable/disable tiers.
        *   `created_at`, `updated_at`: Timestamps.

2.  **Create `user_subscriptions` Table:**
    *   This table will track which users are subscribed to which tiers.
    *   **Columns:**
        *   `id`: Primary key.
        *   `user_id`: Foreign key to the `users` table.
        *   `tier_id`: Foreign key to the `agent_subscription_tiers` table.
        *   `status`: The status of the subscription (e.g., 'active', 'past_due', 'canceled', 'expired').
        *   `current_period_start`: Timestamp for the beginning of the current billing cycle.
        *   `current_period_end`: Timestamp for the end of the current billing cycle.
        *   `canceled_at`: Timestamp if the user has canceled but the subscription is still active until the period end.
        *   `ended_at`: Timestamp when the subscription fully ended.
        *   `latest_transaction_signature`: The signature of the most recent payment transaction.
        *   `created_at`, `updated_at`: Timestamps.

## SQL Schema Example (PostgreSQL)

```sql
-- Table for creators to define their subscription tiers
CREATE TABLE agent_subscription_tiers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    price_amount BIGINT NOT NULL CHECK (price_amount >= 0),
    price_currency_mint VARCHAR(44) NOT NULL,
    interval VARCHAR(20) NOT NULL, -- e.g., 'day', 'week', 'month'
    interval_count INT NOT NULL DEFAULT 1,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (agent_id, name) -- An agent can't have two tiers with the same name
);

-- Table to track active user subscriptions
CREATE TYPE subscription_status AS ENUM ('active', 'past_due', 'canceled', 'expired', 'incomplete');

CREATE TABLE user_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tier_id UUID NOT NULL REFERENCES agent_subscription_tiers(id),
    status subscription_status NOT NULL DEFAULT 'incomplete',
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    canceled_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    latest_transaction_signature VARCHAR(88),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, tier_id) -- A user can only have one subscription to a specific tier at a time.
);

-- Indexes for performance
CREATE INDEX idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX idx_agent_subscription_tiers_agent_id ON agent_subscription_tiers(agent_id);
```
**Note:** This is a foundational schema. A real-world implementation might be more complex, potentially involving a separate `subscription_periods` table for a more detailed history, but this is a strong starting point.
