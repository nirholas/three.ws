# Prompt 20: Usage-Based Billing Model

## Objective
Design the database schema and API structure to support usage-based ("pay-per-call") billing for specific agent skills.

## Explanation
Some skills are better monetized by charging for each use rather than a one-time purchase or subscription (e.g., a call to a powerful AI model, or a complex on-chain analysis). This requires a system to track usage, a way for users to pre-fund a balance, and a mechanism to deduct from that balance on each skill execution.

## Instructions
1.  **Update `agent_skill_prices` Table:**
    *   Add a `billing_type` column (e.g., 'one_time', 'per_call').
    *   The `amount` would now represent the cost per execution for 'per_call' skills.

2.  **Create `user_credit_balances` Table:**
    *   This table will store the pre-paid balance for each user.
    *   Columns: `user_id`, `balance_amount`, `currency_mint`.

3.  **Implement a "Top Up" Flow:**
    *   Create a UI in the user's profile/dashboard to add credits.
    *   This will be a standard payment flow where the user transfers funds (e.g., USDC) to a company-owned treasury wallet. A backend endpoint will verify this transaction and update the user's balance in `user_credit_balances`.

4.  **Modify Skill Execution Endpoint:**
    *   In the main skill execution endpoint, before running the skill, check its `billing_type`.
    *   If it's 'per_call', check if the user has sufficient balance in `user_credit_balances`.
    *   If they do, deduct the skill's `amount` from their balance *before* executing the skill. This must be an atomic operation.
    *   If they don't have enough balance, return an error (e.g., 402 Payment Required) with a message prompting them to top up their account.

## Database Schema Changes

```sql
-- Add billing type to prices table
ALTER TABLE agent_skill_prices
ADD COLUMN billing_type TEXT NOT NULL DEFAULT 'one_time' CHECK (billing_type IN ('one_time', 'per_call'));

-- New table for user credit balances
CREATE TABLE user_credit_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) NOT NULL UNIQUE,
    balance_amount BIGINT NOT NULL DEFAULT 0,
    currency_mint TEXT NOT NULL, -- For now, assume one currency like USDC
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Code Example (Skill Execution Endpoint Snippet)

```javascript
// Inside the skill execution endpoint, after checking basic access
// but before running the skill.

const { data: priceInfo } = await supabase.from('agent_skill_prices')
    .select('amount, billing_type').eq('agent_id', agentId).eq('skill_name', skillName).single();

if (priceInfo && priceInfo.billing_type === 'per_call') {
    // It's a pay-per-call skill, check and deduct balance.
    // This should be done in a database transaction (RPC function in Supabase).
    
    const { error: deductError } = await supabase.rpc('deduct_skill_charge', {
        user_id_in: userId,
        charge_amount: priceInfo.amount
    });

    if (deductError) {
        // The RPC function would throw an error if balance is insufficient.
        return error(res, 402, 'Payment Required: Insufficient credits for this skill.');
    }
}

// ... proceed with skill execution ...
```

### Supabase RPC Function (`deduct_skill_charge`)

```sql
CREATE OR REPLACE FUNCTION deduct_skill_charge(user_id_in UUID, charge_amount BIGINT)
RETURNS void AS $$
DECLARE
  current_balance BIGINT;
BEGIN
  SELECT balance_amount INTO current_balance
  FROM user_credit_balances WHERE user_id = user_id_in;

  IF current_balance IS NULL OR current_balance < charge_amount THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  UPDATE user_credit_balances
  SET balance_amount = balance_amount - charge_amount, updated_at = NOW()
  WHERE user_id = user_id_in;
END;
$$ LANGUAGE plpgsql;
```
