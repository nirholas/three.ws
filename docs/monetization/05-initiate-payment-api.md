---
status: not-started
---

# Prompt 5: Initiate Payment API

## Objective
Create a backend endpoint that prepares a Solana transaction for a skill purchase and sends it to the frontend.

## Explanation
For security and reliability, the transaction should be constructed on the backend. The frontend will request a transaction for a specific skill. The backend will look up the skill's price, the creator's payout address, and the platform's fee address, then create an unsigned transaction and send it back to the frontend. The frontend's only job is to get it signed by the user's wallet.

## Instructions
- [ ] **Create the API Endpoint:**
  - [ ] Create a new API file, e.g., `api/payments/initiate.js`.
  - [ ] This endpoint should accept a `skill_name` and `agent_id` in the request body.
- [ ] **Implement Transaction Logic:**
  - [ ] The endpoint needs to perform several lookups:
    - [ ] The skill's price from `agent_skill_prices`.
    - [ ] The agent creator's payout address.
    - [ ] The platform's fee/treasury address (this can be a constant for now).
  - [ ] Using the Solana SDK (`@solana/web3.js`), construct a transaction. This will likely be a simple SPL-token transfer (e.g., USDC) from the user to the creator, potentially with a second transfer for the platform fee.
  - [ ] Serialize the unsigned transaction and return it in the response, base64-encoded.

## Code Example (Backend - `api/payments/initiate.js`)

```javascript
// This is a simplified example. You'll need error handling and more robust data fetching.
import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { getTokenTransferInstruction } from 'your-token-utils'; // Helper for SPL token transfers

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).end();
    }

    const { skillName, agentId, userWalletAddress } = req.body;

    // 1. Fetch skill price, creator payout address, etc. from your database
    const skillPrice = await db.getSkillPrice(agentId, skillName); // e.g., { amount: 1000000, mint: 'EPj...' }
    const creatorAddress = await db.getCreatorPayoutAddress(agentId);
    const platformFeeAddress = process.env.PLATFORM_FEE_WALLET;
    const platformFeeBps = 500; // 5%

    // 2. Create a new transaction
    const connection = new Connection(process.env.SOLANA_RPC_URL);
    const transaction = new Transaction({
        feePayer: new PublicKey(userWalletAddress),
        recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
    });

    // 3. Calculate amounts
    const creatorAmount = skillPrice.amount * (1 - platformFeeBps / 10000);
    const platformAmount = skillPrice.amount - creatorAmount;

    // 4. Add transfer instructions (this part is complex for SPL tokens, pseudo-code shown)
    // You need to find the user's Associated Token Account (ATA) for the mint.
    const userTokenAccount = await findUserATA(userWalletAddress, skillPrice.mint);

    transaction.add(
        createTokenTransferInstruction(
            userTokenAccount,
            creatorAddress,
            userWalletAddress, // User is the owner of their ATA
            creatorAmount
        )
    );
    transaction.add(
        createTokenTransferInstruction(
            userTokenAccount,
            platformFeeAddress,
            userWalletAddress,
            platformAmount
        )
    );
    
    // 5. Serialize and return
    const serializedTransaction = transaction.serialize({ requireAllSignatures: false });
    
    res.status(200).json({
        transaction: serializedTransaction.toString('base64'),
    });
}
```
