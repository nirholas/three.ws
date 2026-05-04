# Prompt 11: Backend Logic for Payouts

## Objective
Integrate the creator's saved payout wallet address into the skill purchase transaction logic.

## Explanation
Now that creators can specify their payout wallet, we need to ensure our payment processing logic uses this address as the destination for funds. This task involves modifying the backend Solana Pay endpoint to fetch the creator's payout address and use it when constructing the transaction.

## Instructions
1.  **Create a Database Function (`_lib/db.js`):**
    *   Write a new function, `findCreatorPayoutWallet(agentId)`.
    *   This function should first find the `creator_id` (a `user_id`) from the `agents` table using the `agentId`.
    *   Then, it should query the `users` table to get the `payout_wallet_address` for that `creator_id`.
    *   The function should return the wallet address as a string.

2.  **Update the Payment Endpoint (`api/payments/prepare-skill-purchase.js`):**
    *   In the main handler, before you construct the transaction, call your new `findCreatorPayoutWallet` function.
    *   Use the returned wallet address as the `destination` for the main portion of the SPL token transfer.
    *   If no payout wallet is configured for the creator, the transaction should fail with an informative error. This prevents funds from being sent to a null or invalid address.

## Code Example (Backend - `_lib/db.js`)

```javascript
import { db } from './database-client';

export async function findCreatorPayoutWallet(agentId) {
    try {
        const result = await db.one(
            `
            SELECT u.payout_wallet_address
            FROM users u
            JOIN agents a ON a.creator_id = u.id
            WHERE a.id = $1;
            `,
            [agentId]
        );
        return result.payout_wallet_address;
    } catch (error) {
        // 'one' will throw an error if no row is found
        console.error(`Could not find payout wallet for agent ${agentId}:`, error);
        return null;
    }
}
```

## Updated Payment Endpoint (`api/payments/prepare-skill-purchase.js`)

```javascript
// ... (imports)
import { findCreatorPayoutWallet, findSkillPrice } from '../_lib/db';

// ... (handler start)

    try {
        // ... (authentication and body validation)

        // Find the creator's configured payout wallet
        const creatorPayoutWalletAddress = await findCreatorPayoutWallet(agentId);
        if (!creatorPayoutWalletAddress) {
            return res.status(500).json({ 
                error: 'Creator has not configured a payout wallet. Purchase cannot be completed.' 
            });
        }
        const creatorPublicKey = new PublicKey(creatorPayoutWalletAddress);
        
        // ... (find skill price, get blockhash)

        // The rest of the transaction logic now uses creatorPublicKey as the destination
        const creatorUsdcAddress = await getAssociatedTokenAddress(USDC_MINT, creatorPublicKey);

        // ... (create transfer instructions for creator and platform fee)
        transaction.add(
            createTransferInstruction(
                buyerUsdcAddress,
                creatorUsdcAddress, // Use the fetched wallet
                buyerPublicKey,
                creatorAmount
            )
        );
        
        // ... (rest of the logic)

    } catch (error) {
        // ... (error handling)
    }
```
