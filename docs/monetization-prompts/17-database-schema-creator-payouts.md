# Prompt 17: Database Schema for Creator Payouts

## Objective
Create database tables to manage creator earnings and track payout (withdrawal) transactions.

## Explanation
Creators need a way to withdraw their earnings. This requires a system to track their current balance, record each payout request, and log the status of the transaction. This prompt sets up the database foundation for the creator payout system.

## Instructions
1.  **Locate the Schema File:**
    *   Open `api/_lib/schema.sql`.

2.  **Add a `creator_balances` Table:**
    *   This table will hold the current withdrawable balance for each creator. It acts as a ledger.
    *   Columns:
        *   `user_id` (PRIMARY KEY, Foreign key to `users(id)`).
        *   `balance` (BIGINT, the current balance in the smallest currency unit).
        *   `currency_mint` (TEXT).
        *   `updated_at`.

3.  **Add a `creator_payouts` Table:**
    *   This table will log every withdrawal attempt.
    *   Columns:
        *   `id` (UUID PRIMARY KEY).
        *   `user_id` (Foreign key to `users(id)`).
        *   `amount` (BIGINT).
        *   `currency_mint` (TEXT).
        *   `destination_address` (TEXT, the creator's wallet address for the payout).
        *   `status` (ENUM: 'requested', 'processing', 'completed', 'failed').
        *   `transaction_id` (TEXT, the on-chain transaction signature of the payout).
        *   `created_at`, `updated_at`.

## SQL Example

```sql
-- In api/_lib/schema.sql

CREATE TABLE creator_balances (
    user_id UUID PRIMARY KEY REFERENCES users(id),
    balance BIGINT NOT NULL DEFAULT 0,
    currency_mint TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TYPE payout_status AS ENUM ('requested', 'processing', 'completed', 'failed');

CREATE TABLE creator_payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    amount BIGINT NOT NULL,
    currency_mint TEXT NOT NULL,
    destination_address TEXT NOT NULL,
    status payout_status NOT NULL DEFAULT 'requested',
    transaction_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_creator_payouts_user_id ON creator_payouts(user_id);
```
