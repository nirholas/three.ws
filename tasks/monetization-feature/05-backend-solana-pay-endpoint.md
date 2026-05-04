---
status: not-started
---

# Prompt 5: Backend Solana Pay Endpoint

**Status:** Not Started

## Objective
Create a backend endpoint that generates a Solana Pay transaction request for purchasing a skill.

## Explanation
When a user clicks "Buy," the frontend will need to request a transaction from the backend. This endpoint will generate a Solana Pay-compliant response, specifying the recipient wallet (the agent creator's), the amount, the SPL token mint, and a unique reference key for tracking the transaction.

## Instructions
- [ ] **Create a new API endpoint file** (e.g., `/api/payments/solana-pay.js`).
- [ ] **Endpoint Logic:**
    - [ ] It should accept a `POST` request with `agentId` and `skillName`.
    - [ ] Authenticate the user.
    - [ ] Fetch the skill price from the `agent_skill_prices` table.
    - [ ] Fetch the agent creator's wallet address from the `agent_identities` or a related table. This may require adding a `solana_wallet` column to `agent_identities` if it doesn't exist.
    - [ ] Generate a unique reference public key (`Keypair.generate()`). This will be used to find the transaction later.
    - [ ] Construct the Solana Pay response object, which includes a `label`, `icon`, `transaction` (URL for the next step), and `message`.
- [ ] **Return the Solana Pay JSON response.**

## Code Example (Conceptual Node.js)

```javascript
// In /api/payments/solana-pay.js
import { Keypair } from '@solana/web3.js';
// ... other imports

export default wrap(async (req, res) => {
    // ... authentication and validation
    const { agentId, skillName } = await readJson(req);

    // 1. Fetch skill price and creator's wallet
    const [priceInfo] = await sql`...`;
    const [agentInfo] = await sql`...`;
    const recipientWallet = agentInfo.solana_wallet;

    // 2. Generate a reference keypair
    const reference = new Keypair();

    // 3. Construct the Solana Pay response
    const response = {
        label: `3D-Agent Skill Purchase`,
        icon: 'https://3d-agent.com/icon.png',
        // The transaction URL points to another endpoint that builds the actual transaction
        transaction: `${process.env.NEXT_PUBLIC_URL}/api/payments/create-skill-tx?agentId=${agentId}&skillName=${skillName}&reference=${reference.publicKey.toBase58()}`,
        message: `Purchase '${skillName}' for ${(priceInfo.amount / 1e6).toFixed(2)} USDC`
    };

    // You might need to store the reference key in cache/DB to validate the next step
    // await cache.set(`tx-ref:${reference.publicKey.toBase58()}`, { ...details });

    return json(res, 200, response);
});
```
