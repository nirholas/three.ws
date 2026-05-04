---
status: not-started
---

# Prompt 6: Backend Solana Transaction Confirmation

**Status:** Not Started

## Objective
Create a backend endpoint that verifies a Solana transaction signature, and if valid, records the skill purchase in the database.

## Explanation
After a user approves a transaction with their wallet, the wallet will submit it to the network. The frontend will get the transaction signature and send it to our backend. This endpoint will confirm the transaction on-chain, check that the details (amount, recipient) are correct, and then insert a record into the `skill_purchases` table.

## Instructions
- [ ] **Create a new API endpoint file** (e.g., `/api/payments/confirm-tx.js`).
- [ ] **Endpoint Logic:**
    - [ ] Accept a `POST` request with a `transactionSignature`.
    - [ ] Authenticate the user.
    - [ ] Use the Solana RPC API (`@solana/web3.js`) to fetch the confirmed transaction details.
    - [ ] **Crucially, verify:**
        - The transaction was successful.
        - The transfer destination matches the agent creator's wallet.
        - The transfer amount and mint match the skill's price.
        - The transaction includes the unique `reference` key from the Solana Pay request.
    - [ ] If all checks pass, `INSERT` a new row into the `skill_purchases` table.
- [ ] **Return a success or failure response** to the frontend.

## Code Example (Conceptual Node.js)

```javascript
import { Connection } from '@solana/web3.js';
// ...

const connection = new Connection(process.env.SOLANA_RPC_URL);

export default wrap(async (req, res) => {
    const user = await getSessionUser(req);
    // ...
    const { signature, agentId, skillName } = await readJson(req);

    // 1. Fetch transaction
    const tx = await connection.getParsedTransaction(signature, 'confirmed');
    if (!tx || tx.meta.err) {
        return error(res, 400, 'Transaction not confirmed or failed.');
    }

    // 2. Fetch expected price and recipient
    const [priceInfo] = await sql`...`;
    const [agentInfo] = await sql`...`;

    // 3. Verify transaction details (this part is complex and requires parsing instructions)
    // You need to find the correct spl-token transfer instruction and check its `info`.
    const transferInstruction = tx.transaction.message.instructions.find(...)
    const sentAmount = transferInstruction.info.amount;
    const recipient = transferInstruction.info.destination;
    const mint = transferInstruction.info.mint;

    if (recipient !== agentInfo.solana_wallet || sentAmount < priceInfo.amount || mint !== priceInfo.currency_mint) {
         return error(res, 400, 'Transaction details do not match.');
    }

    // 4. Record purchase
    await sql`
        INSERT INTO skill_purchases (user_id, agent_id, skill_name, ...)
        VALUES (${user.id}, ${agentId}, ${skillName}, ...);
    `;

    return json(res, 200, { message: 'Purchase successful!' });
});
```
