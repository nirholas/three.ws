---
status: completed
---

# Prompt 3: Create Purchases Database Table

**Status:** Not Started

## Objective
Create a new database table named `skill_purchases` to record and track every time a user buys a skill. This is a critical piece of infrastructure for managing ownership and revenue.

## Explanation
To know which users have access to which paid skills, we need a permanent record of each successful purchase. This table will link a user, an agent's skill, and the transaction details. It will serve as the source of truth for skill ownership.

## Instructions

1.  **Define the Schema:**
    *   Create a new SQL migration file or use your database management tool to define the schema for the `skill_purchases` table.
    *   The table should include the following columns:
        *   `id`: Primary key (e.g., UUID or auto-incrementing integer).
        *   `user_id`: Foreign key referencing the `users` table. The ID of the user who made the purchase.
        *   `agent_id`: Foreign key referencing the `agents` table. The agent who owns the skill.
        *   `skill_name`: The name of the skill that was purchased (e.g., `text-to-speech`).
        *   `transaction_signature`: The signature of the on-chain transaction. This is proof of payment.
        *   `amount`: The price paid for the skill (in the smallest currency unit, e.g., lamports).
        *   `currency_mint`: The mint address of the currency used for payment (e.g., USDC mint).
        *   `created_at`: Timestamp of when the purchase was recorded.

2.  **Apply the Migration:**
    *   Run the migration to create the new table in your database.

## Example SQL Schema (PostgreSQL)

```sql
CREATE TABLE "skill_purchases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users" ("id"),
  "agent_id" uuid NOT NULL REFERENCES "agents" ("id"),
  "skill_name" varchar(255) NOT NULL,
  "transaction_signature" varchar(255) UNIQUE NOT NULL,
  "amount" bigint NOT NULL,
  "currency_mint" varchar(255) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "idx_skill_purchases_user_id" ON "skill_purchases" ("user_id");
CREATE INDEX "idx_skill_purchases_agent_id" ON "skill_purchases" ("agent_id");
```
