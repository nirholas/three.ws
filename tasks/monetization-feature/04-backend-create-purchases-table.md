---
status: not-started
---

# Prompt 4: Create Purchases Database Table

**Status:** Not Started

## Objective
Create a database table (`skill_purchases`) to record which users have purchased which skills.

## Explanation
To grant users access to paid skills, we need to track their purchases. This table will create an association between a user, an agent's skill, and the transaction details of the purchase.

## Instructions
- [ ] **Update the Migration Script:**
    - [ ] Add a new `CREATE TABLE` statement to your `scripts/migrate-db.mjs` script.
- [ ] **Define the Table Schema:**
    - [ ] The `skill_purchases` table should include:
        - `user_id`: Foreign key to the `users` table.
        - `agent_id`: Foreign key to the `agent_identities` table.
        - `skill_name`: The name of the skill purchased.
        - `transaction_signature`: The Solana transaction signature of the purchase.
        - `purchase_amount`: The amount paid.
        - `purchase_currency_mint`: The currency used.
        - `created_at`: A timestamp for the purchase date.
    - [ ] Create a primary key or unique constraint on `(user_id, agent_id, skill_name)`.
- [ ] **Execute and Verify:**
    - [ ] Run the migration script.
    - [ ] Verify the table is created correctly in your database.

## Code Example (SQL)

```sql
CREATE TABLE IF NOT EXISTS skill_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL,
  skill_name VARCHAR(255) NOT NULL,
  transaction_signature VARCHAR(255) UNIQUE NOT NULL,
  purchase_amount BIGINT NOT NULL,
  purchase_currency_mint VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Foreign key to the prices table at the time of purchase
  FOREIGN KEY (agent_id, skill_name) REFERENCES agent_skill_prices(agent_id, skill_name) ON DELETE SET NULL,
  -- Prevent user from buying the same skill twice
  UNIQUE (user_id, agent_id, skill_name)
);
```
