---
status: not-started
---

# Prompt 2: Backend - Create Skill Pricing Table

## Objective
Create the necessary database table to store the prices of agent skills. This is a foundational step for the monetization feature.

## Explanation
To make skills purchasable, we need a dedicated table in our database (`agent_skill_prices`) that links a skill to a price, currency, and the creator who sets the price. This structure will allow us to easily query for a skill's price and manage payments.

## Instructions
1.  **Define the Schema:**
    *   Create a new SQL migration file.
    *   Define the schema for the `agent_skill_prices` table. It should include the following fields:
        *   `id`: Primary key (e.g., UUID).
        *   `skill_id`: Foreign key referencing the `skills` table.
        *   `creator_id`: Foreign key referencing the `users` table (the user who created the skill and will receive payment).
        *   `amount`: The price of the skill in the smallest unit of the currency (e.g., lamports for SOL, or 10^-6 for USDC). Use a `BIGINT` or `NUMERIC` to handle large numbers without precision loss.
        *   `currency_mint`: The public key of the SPL token used for payment (e.g., USDC's mint address). Stored as a string.
        *   `created_at` / `updated_at`: Timestamps.

2.  **Apply the Migration:**
    *   Run the migration to create the table in your development database.

## Code Example (SQL Migration)

```sql
CREATE TABLE agent_skill_prices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount BIGINT NOT NULL,
    currency_mint VARCHAR(44) NOT NULL, -- Solana public key length
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- A skill should only have one price set by its creator
    UNIQUE (skill_id, creator_id)
);

-- Create an index for efficient price lookups by skill
CREATE INDEX idx_agent_skill_prices_on_skill_id ON agent_skill_prices(skill_id);

-- Optional: Trigger to auto-update updated_at timestamp
CREATE TRIGGER set_timestamp
BEFORE UPDATE ON agent_skill_prices
FOR EACH ROW
EXECUTE PROCEDURE trigger_set_timestamp();
```
