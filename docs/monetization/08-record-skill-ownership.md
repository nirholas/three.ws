# Prompt 8: Record Skill Ownership in Database

## Status
- [ ] Not Started

## Objective
Create a database table to track which users have purchased which skills, and an API endpoint to record a successful purchase.

## Explanation
After a transaction is successfully confirmed on the blockchain, we need to record the user's ownership of the skill in our own database. This allows us to easily check if a user has access to a skill without needing to query the blockchain every time.

## Instructions
1.  **Design `user_owned_skills` Table:**
    *   Create a new table with columns like:
        *   `id`: Primary key.
        *   `user_id`: Foreign key to the `users` table.
        *   `agent_id`: Foreign key to the `agents` table.
        *   `skill_name`: The name of the purchased skill.
        *   `purchase_transaction_signature`: The Solana transaction signature of the purchase.
        *   `created_at`: Timestamp.
    *   Add a unique constraint on `(user_id, agent_id, skill_name)`.

2.  **Create a "Finalize Purchase" API Endpoint:**
    *   Create a new endpoint, e.g., `POST /api/payments/finalize-purchase`.
    *   This endpoint will be called by the frontend *after* a transaction has been confirmed.
    *   It should accept the `agent_id`, `skill_name`, and `transaction_signature`.

3.  **Implement Finalization Logic:**
    *   The backend should first verify the transaction signature on the Solana network to ensure it's valid and recent.
    *   It should decode the transaction to confirm that the correct amount was transferred to the correct seller.
    *   If the transaction is valid, insert a new record into the `user_owned_skills` table.

## SQL Example
```sql
CREATE TABLE user_owned_skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    skill_name VARCHAR(255) NOT NULL,
    purchase_transaction_signature VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_user_owned_skills_on_user_agent_skill
ON user_owned_skills (user_id, agent_id, skill_name);
```

## Code Example (Backend - `/api/payments/finalize-purchase.js`)
```javascript
import { Connection } from '@solana/web3.js';
import { recordSkillOwnership } from './_db.js'; // DB function

export default async function handler(req, res) {
  const { agentId, skillName, transactionSignature, userId } = req.body;

  // 1. Verify transaction on-chain
  const connection = new Connection(process.env.SOLANA_RPC_URL, 'confirmed');
  const tx = await connection.getTransaction(transactionSignature, { maxSupportedTransactionVersion: 0 });
  
  if (!tx) {
    return res.status(400).json({ error: 'Transaction not found or not confirmed.' });
  }

  // 2. (Recommended) Decode the transaction to verify its contents
  // This part can be complex, involving parsing instructions and account keys.
  // For simplicity here, we're trusting the client, but in production, you MUST verify:
  // - The source wallet matches the user.
  // - The destination wallet matches the agent creator.
  // - The transfer amount and mint are correct.
  const isTransactionValid = true; // Placeholder for real validation logic

  if (!isTransactionValid) {
      return res.status(400).json({ error: 'Transaction validation failed.' });
  }
  
  // 3. Record ownership in the database
  await recordSkillOwnership(userId, agentId, skillName, transactionSignature);

  res.status(200).json({ success: true });
}
```

## Frontend Update
After a successful purchase, the frontend should call this new endpoint.
```javascript
// Inside the purchase success block in the frontend
const signature = await connection.sendRawTransaction(signedTransaction.serialize());
await connection.confirmTransaction(signature, 'confirmed');

// New part: Finalize with your backend
await fetch('/api/payments/finalize-purchase', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentId: currentAgent.id,
      skillName: skillData.skillName,
      transactionSignature: signature,
      userId: currentUser.id // Assuming you have the user's ID
    }),
});

alert('Purchase successful and recorded!');
```
