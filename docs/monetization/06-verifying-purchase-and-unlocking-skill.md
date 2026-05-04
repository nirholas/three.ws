# Prompt 6: Verifying Purchase and Unlocking Skill

## Objective
Create a backend system to verify that a skill purchase transaction was successful on-chain and then formally grant the user access to that skill in the database.

## Explanation
After the frontend submits the transaction to the Solana network, it gets a transaction signature. The frontend then sends this signature to our backend. The backend's job is to use this signature to query the Solana blockchain, confirm the transaction was successfully processed and finalized, and then update our application's database to reflect that the user now owns the skill. This is a critical step for security and ensuring users get what they paid for.

## Instructions
1.  **Create a Verification Endpoint:**
    *   Create a new API endpoint, e.g., `/api/marketplace/skills/verify-purchase`.
    *   This endpoint will accept a POST request containing the `transactionSignature`, `agentId`, and `skillName`.

2.  **Backend Verification Logic:**
    *   The endpoint will use the Solana `@solana/web3.js` library to connect to the cluster.
    *   It will call `connection.getTransaction(transactionSignature)` to fetch the transaction details.
    *   The backend must parse the transaction to ensure it matches what was expected:
        *   Was the transfer from the correct buyer?
        *   Was it to the correct creator treasury?
        *   Was the amount correct?
        *   Was the currency (mint) correct?
    *   This verification prevents users from sending fake transaction signatures or signatures for unrelated transactions.

3.  **Update the Database:**
    *   If the on-chain transaction is fully verified, the backend will add a new record to a `user_purchased_skills` table.
    *   This table should link a user ID to the agent ID and skill name they purchased.

## Database Schema (`user_purchased_skills`)

```sql
CREATE TABLE user_purchased_skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) NOT NULL,
    agent_id UUID REFERENCES agents(id) NOT NULL,
    skill_name TEXT NOT NULL,
    purchased_at TIMESTAMPTZ DEFAULT NOW(),
    transaction_signature TEXT NOT NULL,
    UNIQUE(user_id, agent_id, skill_name)
);
```

## Code Example (`api/marketplace/skills/verify-purchase.js`)

```javascript
import { Connection, clusterApiUrl } from '@solana/web3.js';
import { supabase } from '../../_lib/supabase';
import { json, error } from '../../_lib/http';

export default async function handler(req, res) {
    const { transactionSignature, agentId, skillName } = req.body;
    // Assume we get userId from session/token
    const { userId } = await getUserFromRequest(req); 

    if (!userId) return error(res, 401, 'Unauthorized');

    const connection = new Connection(clusterApiUrl('devnet'));
    
    // 1. Confirm the transaction is valid and finalized
    const tx = await connection.getTransaction(transactionSignature, { maxSupportedTransactionVersion: 0 });

    if (!tx || !tx.meta || tx.meta.err) {
        return error(res, 400, 'Transaction not found or failed.');
    }

    // 2. Perform deep verification (omitted for brevity, but crucial)
    // - Check sender, receiver, amount, mint etc. match expected values
    // - This prevents re-using old signatures or sending malicious ones.

    // 3. If verified, record the purchase in the database
    const { error: dbError } = await supabase
        .from('user_purchased_skills')
        .insert({
            user_id: userId,
            agent_id: agentId,
            skill_name: skillName,
            transaction_signature: transactionSignature,
        });

    if (dbError) {
        // Handle potential unique constraint violation (user trying to re-verify)
        if (dbError.code === '23505') {
            return json(res, { success: true, message: 'Skill already unlocked.' });
        }
        return error(res, 500, 'Failed to record purchase.');
    }

    return json(res, { success: true, message: 'Skill unlocked successfully!' });
}
```
