# Prompt 18: DB Schema for Earnings and Platform Fees

## Objective
Design and create the database table schema for `skill_payment_earnings` to reliably track revenue for creators and calculate platform fees.

## Explanation
When a payment is successfully completed, the revenue needs to be allocated. This table will store a record of each sale, attributing the earnings to the correct creator, and clearly separating the gross amount, the platform's cut, and the net amount due to the creator. This is fundamental for accurate accounting and payouts.

## Instructions
1.  **Define the Table Schema:**
    *   Create a new table named `skill_payment_earnings`.
    *   It should include the following columns:
        *   `id`: Primary key (UUID or auto-incrementing integer).
        *   `payment_id`: A unique foreign key referencing `skill_payments(id)`. This ensures each payment has only one corresponding earnings entry.
        *   `agent_id`: Foreign key to `agents(id)`.
        *   `creator_id`: Foreign key to `users(id)`, identifying the user who gets the earnings.
        *   `gross_amount`: The total amount paid by the user (in lamports or smallest unit).
        *   `platform_fee_bps`: The platform fee basis points at the time of the transaction (e.g., `500` for 5%).
        *   `platform_fee_amount`: The calculated platform fee (`gross_amount * platform_fee_bps / 10000`).
        *   `net_amount`: The amount due to the creator (`gross_amount - platform_fee_amount`).
        *   `currency_mint`: The mint address of the currency used.
        *   `payout_id`: A nullable foreign key that will link to a `payouts` table when the earnings are withdrawn.
        *   `created_at`: Timestamp.

2.  **Create Indexes:**
    *   Create an index on `creator_id` to quickly query for all earnings belonging to a specific creator for their dashboard.
    *   Create an index on `payout_id` to find all earnings included in a specific payout batch.

3.  **Write the SQL Migration:**
    *   Create a new SQL migration file to apply this schema change to your database.

## SQL Schema Example

```sql
CREATE TABLE skill_payment_earnings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID NOT NULL UNIQUE REFERENCES skill_payments(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES agents(id),
    creator_id UUID NOT NULL REFERENCES users(id),
    
    gross_amount BIGINT NOT NULL,
    platform_fee_bps INTEGER NOT NULL, -- e.g., 500 for 5.00%
    platform_fee_amount BIGINT NOT NULL,
    net_amount BIGINT NOT NULL,
    
    currency_mint VARCHAR(255) NOT NULL,
    
    -- This will be NULL until the earnings are included in a payout
    payout_id UUID REFERENCES payouts(id), 

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT check_amounts CHECK (gross_amount = platform_fee_amount + net_amount)
);

-- Index for creator dashboard queries
CREATE INDEX idx_skill_earnings_creator_id ON skill_payment_earnings(creator_id);

-- Index for finding earnings in a payout
CREATE INDEX idx_skill_earnings_payout_id ON skill_payment_earnings(payout_id);


-- You will also need a payouts table for later prompts
CREATE TABLE payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id UUID NOT NULL REFERENCES users(id),
    amount BIGINT NOT NULL,
    currency_mint VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, completed, failed
    destination_address VARCHAR(255) NOT NULL,
    tx_signature VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);
```
