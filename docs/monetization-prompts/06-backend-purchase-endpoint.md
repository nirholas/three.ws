# Prompt 6: Create Backend Endpoint to Verify and Record Purchase

**Status:** - [ ] Not Started

## Objective
Create a backend API endpoint that the frontend can call after a Solana transaction is successfully confirmed. This endpoint will verify the transaction on-chain and record the skill ownership in the database.

## Explanation
Client-side confirmation of a transaction is not enough. For security and reliability, the backend must independently verify that the correct payment was made before granting the user access to the skill.

## Instructions
1.  **Create a New API Endpoint:**
    *   Create a new file for the endpoint, e.g., `api/marketplace/purchase-skill.js`.
    *   This endpoint should accept the `agentId`, `skillName`, and the `transactionSignature` as input.
    *   It must be an authenticated endpoint, ensuring a user is logged in.

2.  **Implement Transaction Verification:**
    *   In the endpoint's handler, use `@solana/web3.js` to connect to a Solana RPC node.
    *   Fetch the confirmed transaction using the provided signature.
    *   Parse the transaction details to verify:
        *   The transaction was successful.
        *   The source address matches the logged-in user's wallet address.
        *   The destination address matches the agent creator's wallet address.
        *   The transferred amount is correct for the skill being purchased.
        *   The mint of the transferred token is correct.

3.  **Record Ownership in the Database:**
    *   If verification is successful, insert a new record into a table that tracks skill ownership. Let's call this table `user_agent_skills`.
    *   The table should store at least the `user_id`, `agent_id`, and `skill_name`.

## Code Example (Backend - `api/marketplace/purchase-skill.js`)

```javascript
import { Connection, PublicKey } from '@solana/web3.js';
import { getDB } from './_lib/db'; // Your database utility

export default async function handler(req, res) {
  // Assume user is authenticated and user ID is available
  const userId = req.user.id;
  const { agentId, skillName, transactionSignature } = req.body;

  // Fetch agent and skill price details from your DB
  const db = getDB();
  const agent = await db.getAgent(agentId);
  const skillPrice = await db.getSkillPrice(agentId, skillName);

  if (!agent || !skillPrice) {
    return res.status(404).json({ error: 'Agent or skill not found.' });
  }

  try {
    const connection = new Connection('your_rpc_url');
    const tx = await connection.getParsedTransaction(transactionSignature, 'confirmed');

    if (!tx) throw new Error('Transaction not found.');

    // Very simplified verification logic. In reality, this needs to be very robust.
    const instruction = tx.transaction.message.instructions.find(
      (ix) => ix.parsed?.type === 'transfer'
    );
    
    const transferInfo = instruction.parsed.info;
    const isCorrectAmount = BigInt(transferInfo.amount) === BigInt(skillPrice.amount);
    const isCorrectDestination = new PublicKey(transferInfo.destination).equals(new PublicKey(agent.creator_address));
    
    if (isCorrectAmount && isCorrectDestination) {
      // Record the purchase in the database
      await db.recordSkillPurchase(userId, agentId, skillName);
      return res.status(200).json({ success: true, message: 'Purchase successful!' });
    } else {
      throw new Error('Transaction verification failed.');
    }

  } catch (error) {
    console.error('Purchase verification failed:', error);
    return res.status(500).json({ error: 'Purchase verification failed.' });
  }
}
```
