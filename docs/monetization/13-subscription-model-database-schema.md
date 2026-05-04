# Prompt 13: Subscription Model Database Schema

## Objective
Design and create the necessary database tables to support a subscription-based monetization model for agent skills.

## Explanation
To move beyond one-time purchases, we need to support subscriptions. This will allow creators to offer bundles of skills for a recurring fee (e.g., monthly). This task focuses on the database design, which is the foundation for the subscription feature. We will need tables to manage subscription plans (tiers), and to track which users are subscribed to which plans.

## Instructions
1.  **Design `agent_subscription_tiers` Table:**
    *   This table will store the different subscription plans a creator can offer for an agent.
    *   It should include columns for the agent it belongs to, a name (e.g., "Pro"), a price, a currency, and a billing interval (e.g., 'month', 'year').
    *   It should also include an array of skill names that are included in this tier.

2.  **Design `user_subscriptions` Table:**
    *   This table will track active user subscriptions.
    *   It should link a user to a subscription tier.
    *   It needs columns to manage the subscription's lifecycle, such as `status` (e.g., 'active', 'canceled'), `current_period_start`, and `current_period_end`.

3.  **Write SQL Schema:**
    *   Write the `CREATE TABLE` SQL statements for these new tables. Include appropriate foreign keys, constraints, and indexes.

## SQL Schema Definition

```sql
-- Table to define the subscription plans for an agent
CREATE TABLE agent_subscription_tiers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID REFERENCES agents(id) NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    price_amount BIGINT NOT NULL, -- Price in smallest unit
    price_currency_mint TEXT NOT NULL,
    billing_interval TEXT NOT NULL CHECK (billing_interval IN ('month', 'year')), -- e.g., monthly, yearly
    included_skills TEXT[] NOT NULL, -- An array of skill names included in this tier
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(agent_id, name)
);

-- Table to track which user is subscribed to which tier
CREATE TABLE user_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) NOT NULL,
    tier_id UUID REFERENCES agent_subscription_tiers(id) NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'canceled', 'past_due')),
    current_period_start TIMESTAMPTZ NOT NULL,
    current_period_end TIMESTAMPTZ NOT NULL,
    cancel_at_period_end BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes for performance
CREATE INDEX idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX idx_user_subscriptions_tier_id ON user_subscriptions(tier_id);

-- RLS Policies
ALTER TABLE agent_subscription_tiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Creators can manage their own subscription tiers"
ON agent_subscription_tiers FOR ALL
USING (auth.uid() = (SELECT creator_id FROM agents WHERE id = agent_id));

ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own subscriptions"
ON user_subscriptions FOR SELECT
USING (auth.uid() = user_id);
```
