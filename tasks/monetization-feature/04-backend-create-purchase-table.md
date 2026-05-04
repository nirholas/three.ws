---
status: not-started
---

# Prompt 4: Backend - Create Purchase History Table

**Status:** Not Started

## Objective
Create a database table to log every skill purchase, serving as a permanent record of transactions.

## Explanation
To manage access to paid skills, we need to record who purchased what. The `skill_purchases` table will store the user who made the purchase, the agent and skill they bought, the transaction details (like a Solana transaction signature), and the amount paid. This table is crucial for verifying access and for creator analytics.

## Instructions
- [ ] **Connect to your database.**
- [ ] **Execute the following SQL schema to create the `skill_purchases` table.** This schema links a user to a specific agent's skill. It's designed to prevent duplicate purchase records for the same skill and includes a unique transaction signature.

## SQL Schema

```sql
CREATE TABLE IF NOT EXISTS skill_purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    agent_id UUID NOT NULL,
    skill_name VARCHAR(255) NOT NULL,
    amount_paid BIGINT NOT NULL,
    currency_mint VARCHAR(44) NOT NULL,
    transaction_ref VARCHAR(255) UNIQUE NOT NULL, -- e.g., Solana Tx Signature or Stripe Charge ID
    purchase_date TIMESTAMPTZ DEFAULT NOW(),
    
    -- Ensures a user can only buy a specific skill on an agent once
    UNIQUE (user_id, agent_id, skill_name)
);

-- Add indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_skill_purchases_user_id ON skill_purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_skill_purchases_agent_id ON skill_purchases(agent_id);
```

## Tracking
- To mark this task as complete, check the box in the instructions above and change the status in the frontmatter to `Completed`.
