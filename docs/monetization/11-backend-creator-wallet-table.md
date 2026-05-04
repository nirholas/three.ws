---
status: not-started
---

# Prompt 11: Backend - Creator Wallet Table

## Objective
Create a database table for agent creators to securely store their Solana payout wallet address.

## Explanation
To pay creators their share of skill sales, we need to know where to send the funds. A dedicated table, `creator_payout_wallets`, will store a mapping between a `user_id` and their chosen Solana wallet address. This separates the payout wallet from their login credentials or other profile information, providing flexibility and better security.

## Instructions
1.  **Design the Table Schema:**
    *   Name the table `creator_payout_wallets`.
    *   It needs a column to link to the user (`user_id`), which should be unique. This enforces a one-to-one relationship: one user account has one payout wallet.
    *   It needs a column to store the Solana wallet public key (`wallet_address` as `VARCHAR(44)`).
    *   Add a primary key on `user_id` for efficient lookups and to enforce the unique constraint.
    *   Add a foreign key constraint from `user_id` to the `users(id)` table.
    *   Include `created_at` and `updated_at` timestamps.

2.  **Create a SQL Migration File:**
    *   Create a new SQL migration file (e.g., `scripts/migrations/004_create_creator_payout_wallets.sql`).
    *   Write the `CREATE TABLE` statement for `creator_payout_wallets`.
    *   Set up the `updated_at` trigger for this new table as you've done for previous tables.

## Code Example (SQL)

```sql
-- scripts/migrations/004_create_creator_payout_wallets.sql

CREATE TABLE IF NOT EXISTS creator_payout_wallets (
    user_id INTEGER PRIMARY KEY,
    -- Solana public key address
    wallet_address VARCHAR(44) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_user
        FOREIGN KEY(user_id) 
        REFERENCES users(id)
        ON DELETE CASCADE
);

-- Use the existing trigger function for updated_at
CREATE TRIGGER set_timestamp
BEFORE UPDATE ON creator_payout_wallets
FOR EACH ROW
EXECUTE PROCEDURE set_updated_at_timestamp();

```

## Note on Data Integrity
By setting `user_id` as the primary key, we ensure that each user can only have one payout wallet entry. When they want to change their wallet, we will perform an `UPDATE` operation on their existing row rather than inserting a new one.
