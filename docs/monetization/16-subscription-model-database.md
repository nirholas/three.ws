# Prompt 16: Subscription Model Database Schema

## Objective
Update the database schema to support recurring subscriptions for agent access, allowing creators to offer monthly or yearly tiers.

## Explanation
Moving beyond individual skill sales, subscriptions offer a predictable revenue stream for creators and a better value proposition for users who want full access. This foundational step involves designing the necessary database tables to track subscription plans and user statuses.

## Instructions
1.  **Design `subscription_tiers` Table:**
    *   Create a new table named `subscription_tiers`.
    *   This table will define the plans a creator can offer for an agent.
    *   Columns should include:
        *   `id`: Primary key.
        *   `agent_id`: Foreign key to the `agents` table.
        *   `name`: The name of the tier (e.g., "Pro," "All-Access").
        *   `price`: The cost of the subscription.
        *   `currency_mint`: The currency of the price.
        *   `interval`: The billing period (e.g., 'month', 'year').
        *   `description`: A brief description of the tier.

2.  **Design `user_subscriptions` Table:**
    *   Create a new table named `user_subscriptions` to track which users are subscribed to which tiers.
    *   Columns should include:
        *   `id`: Primary key.
        *   `user_id`: Foreign key to the `users` table.
        *   `tier_id`: Foreign key to the `subscription_tiers` table.
        *   `start_date`: Timestamp when the subscription started.
        *   `end_date`: Timestamp when the subscription is due to expire.
        *   `status`: The current status (e.g., 'active', 'cancelled', 'past_due').
        *   `last_payment_signature`: The transaction signature of the last successful payment.

3.  **Apply Migrations:**
    *   Create and run a new database migration script to apply these schema changes.

## SQL Schema Example
```sql
CREATE TABLE subscription_tiers (
    id SERIAL PRIMARY KEY,
    agent_id INTEGER REFERENCES agents(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    price BIGINT NOT NULL, -- in smallest currency unit, e.g., lamports
    currency_mint VARCHAR(255) NOT NULL,
    interval VARCHAR(50) NOT NULL, -- 'month' or 'year'
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_subscriptions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    tier_id INTEGER REFERENCES subscription_tiers(id) ON DELETE CASCADE,
    start_date TIMESTAMP WITH TIME ZONE NOT NULL,
    end_date TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(50) NOT NULL,
    last_payment_signature VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```
