---
status: not-started
---
# Prompt 3: Create Skill Purchases Database Table

**Status:** Not Started

## Objective
Create a database table to log and verify every time a user purchases a skill for one of their agents.

## Explanation
Tracking purchases is critical for granting users access to paid skills and for providing creators with sales history. The `skill_purchases` table will act as a ledger, recording which user bought which skill for which of their agents, along with transaction details for verification.

## Instructions
- **Connect to your database.**
- **Execute the following SQL statement to create the `skill_purchases` table.**

### SQL Schema
```sql
CREATE TABLE skill_purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    price_id UUID NOT NULL REFERENCES agent_skill_prices(id),
    purchase_amount BIGINT NOT NULL,
    purchase_currency_mint VARCHAR(255) NOT NULL,
    transaction_signature VARCHAR(255) UNIQUE NOT NULL, -- For on-chain transaction verification
    purchased_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for faster queries
CREATE INDEX idx_skill_purchases_on_agent_id ON skill_purchases(agent_id);
CREATE INDEX idx_skill_purchases_on_user_id ON skill_purchases(user_id);
CREATE INDEX idx_skill_purchases_on_skill_id ON skill_purchases(skill_id);
```

## Verification
- Verify that the `skill_purchases` table exists in your database with the correct schema.
- Ensure the indexes are created, as this table could grow large and will be queried frequently to check skill access rights.
