---
status: not-started
---

# Prompt 6: Backend - Payment Verification and Skill Unlock

## Objective
Verify completed Solana transactions and record skill purchases to grant users access.

## Explanation
After a user approves a payment, the backend must confirm the transaction on-chain and then "unlock" the skill for them. This involves creating a record that permanently links the user to their purchased skill, ensuring they have access in the future.

## Instructions
1.  **Create a `user_purchased_skills` Table:**
    *   Create a new migration file.
    *   Define a table to store successful purchases. It should include `user_id`, `agent_id`, `skill_name`, `transaction_signature`, and `created_at`.

2.  **Add a Verification Endpoint (or logic):**
    *   The Solana Pay transaction can include a `memo` with a unique reference ID for the purchase.
    *   Create a new endpoint, e.g., `/api/payments/verify`, that the frontend can call after the user signs the transaction.
    *   Alternatively, you can have a backend service that polls or uses a webhook to find transactions addressed to the creator's wallet.

3.  **Implement Verification Logic:**
    *   When the verification is triggered, the backend should:
        *   Receive the transaction signature.
        *   Use the Solana SDK (`connection.getTransaction(signature)`) to fetch the transaction details from the blockchain.
        *   Validate that the transaction transferred the correct amount of the correct currency to the correct recipient.
        *   Check that this transaction signature has not already been processed.

4.  **Insert Purchase Record:**
    *   If the transaction is valid, insert a new row into the `user_purchased_skills` table.

## SQL Example for Table

```sql
CREATE TABLE user_purchased_skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    agent_id UUID NOT NULL REFERENCES agents(id),
    skill_name VARCHAR(128) NOT NULL,
    transaction_signature VARCHAR(128) NOT NULL UNIQUE,
    purchase_price NUMERIC(20, 0) NOT NULL,
    purchase_currency VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_purchased_skills_user_id ON user_purchased_skills(user_id);
```

## Code Snippet (Verification Logic)

```javascript
// Inside the verification endpoint
const { signature } = req.body;

const tx = await connection.getTransaction(signature, { maxSupportedTransactionVersion: 0 });

if (!tx) {
  return error(res, 404, 'transaction_not_found');
}

// ... deep validation of transaction details ...
// 1. Check recipient address
// 2. Check transfer amount
// 3. Check currency mint (if SPL token)

// If valid, insert into the database
await sql`
  INSERT INTO user_purchased_skills (user_id, agent_id, skill_name, transaction_signature, ...)
  VALUES (...)
`;

// Return success to the client
return json(res, 200, { success: true, message: 'Skill unlocked!' });
```
