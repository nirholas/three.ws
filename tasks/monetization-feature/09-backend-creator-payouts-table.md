---
status: not-started
---

# Prompt 9: Create Creator Payouts Table

**Status:** Not Started

## Objective
Create the necessary database tables to manage payouts for agent creators.

## Explanation
To complete the monetization loop, we need to track how much each agent creator has earned and when they get paid. This involves two tables: one to store creator wallet/payout information (`creator_payout_settings`) and another to log each payout transaction (`payouts`).

## Instructions
- [ ] **Update the Migration Script:** Add `CREATE TABLE` statements for two new tables in `scripts/migrate-db.mjs`.
- [ ] **`creator_payout_settings` Schema:**
    - `user_id`: Foreign key to `users`. This is the agent creator.
    - `payout_wallet_address`: The Solana address where they want to receive funds.
    - `payout_currency_mint`: The currency they prefer for payouts.
- [ ] **`payouts` Schema:**
    - `id`: Primary key.
    - `user_id`: The user (creator) who was paid.
    - `amount`: The total amount paid out.
    - `currency_mint`: The currency of the payout.
    - `transaction_signature`: The on-chain signature of the payout transaction.
    - `created_at`: Timestamp of the payout.
    - It should also include details on the earnings period this payout covers.
- [ ] **Execute and Verify** the migration.

## Code Example (SQL)

```sql
CREATE TABLE IF NOT EXISTS creator_payout_settings (
  user_id UUID PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payout_wallet_address VARCHAR(255) NOT NULL,
  payout_currency_mint VARCHAR(255) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  amount BIGINT NOT NULL,
  currency_mint VARCHAR(255) NOT NULL,
  -- Could be a Solana tx sig or a Stripe transfer ID, etc.
  transaction_signature VARCHAR(255) UNIQUE,
  earnings_start_date DATE NOT NULL,
  earnings_end_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```
