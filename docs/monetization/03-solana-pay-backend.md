# Prompt 3: Solana Pay Integration (Backend)

## Objective
Create a backend API endpoint that generates a Solana Pay transaction request when a user decides to purchase a skill.

## Explanation
To securely handle payments, we will use Solana Pay. This standard allows us to create a transaction on the backend and present it to the user's mobile wallet for approval. This prompt focuses on creating the API endpoint that prepares this transaction. The endpoint will receive a skill name, look up its price, and construct a transaction to transfer the correct amount of USDC from the buyer to the seller.

## Instructions
1.  **Create a New API Endpoint:**
    *   In the `api/payments/` directory, create a new file named `prepare-skill-purchase.js`.
    *   This endpoint should handle `POST` requests and expect a `skillName` and `agentId` in the request body.

2.  **Implement the Endpoint Logic:**
    *   The endpoint needs to perform several actions:
        *   Authenticate the user to identify the buyer.
        *   From the `agentId`, look up the agent and its creator.
        *   From the creator's profile, retrieve their payout wallet address.
        *   From `skillName` and `agentId`, query the `agent_skill_prices` table to get the skill's price (amount and currency). For now, we'll assume USDC.
        *   Construct a Solana transaction using the `@solana/web3.js` library to transfer the specified amount of USDC from the buyer to the creator.
        *   Return the transaction details in the format required by the Solana Pay spec. This includes the transaction itself (serialized), a message, and a label.

3.  **Dependencies:**
    *   You will need to add `@solana/pay` and `@solana/spl-token` to your backend dependencies if they are not already present.

## Code Example (Backend - `api/payments/prepare-skill-purchase.js`)

```javascript
// api/payments/prepare-skill-purchase.js
import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddress, createTransferInstruction } from '@solana/spl-token';
import { findCreatorPayoutWallet, findSkillPrice } from '../_lib/db'; // Placeholder for DB functions

const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyB7u6d');
const PLATFORM_WALLET = new PublicKey('YourPlatformWalletAddressHere'); // Your platform's treasury wallet

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        // User must be authenticated (logic not shown)
        const buyerPublicKey = new PublicKey(req.user.solana_wallet); 

        const { agentId, skillName } = req.body;
        if (!agentId || !skillName) {
            return res.status(400).json({ error: 'agentId and skillName are required' });
        }

        const priceInfo = await findSkillPrice(agentId, skillName);
        if (!priceInfo) {
            return res.status(404).json({ error: 'Skill or price not found' });
        }

        const creatorPayoutWallet = await findCreatorPayoutWallet(agentId);
        if (!creatorPayoutWallet) {
            return res.status(500).json({ error: 'Creator payout wallet not configured' });
        }

        const connection = new Connection(process.env.SOLANA_RPC_URL);
        const { blockhash } = await connection.getLatestBlockhash();

        const transaction = new Transaction({
            recentBlockhash: blockhash,
            feePayer: buyerPublicKey,
        });

        const buyerUsdcAddress = await getAssociatedTokenAddress(USDC_MINT, buyerPublicKey);
        const creatorUsdcAddress = await getAssociatedTokenAddress(USDC_MINT, new PublicKey(creatorPayoutWallet));

        // Assuming a 5% platform fee
        const platformFee = Math.floor(priceInfo.amount * 0.05);
        const creatorAmount = priceInfo.amount - platformFee;
        
        // Transfer to creator
        transaction.add(
            createTransferInstruction(
                buyerUsdcAddress,
                creatorUsdcAddress,
                buyerPublicKey,
                creatorAmount
            )
        );

        // Transfer to platform
        const platformUsdcAddress = await getAssociatedTokenAddress(USDC_MINT, PLATFORM_WALLET);
        transaction.add(
            createTransferInstruction(
                buyerUsdcAddress,
                platformUsdcAddress,
                buyerPublicKey,
                platformFee
            )
        );

        const serializedTransaction = transaction.serialize({ requireAllSignatures: false });

        res.status(200).json({
            transaction: serializedTransaction.toString('base64'),
            message: `Purchase skill "${skillName}" for ${(priceInfo.amount / 1e6).toFixed(2)} USDC`,
            label: 'three.ws Agent Skill',
        });

    } catch (error) {
        console.error('Error preparing skill purchase:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}
```
