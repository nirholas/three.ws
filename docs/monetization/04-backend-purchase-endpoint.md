# Prompt 4: Backend Purchase Endpoint

## Objective
Create a backend API endpoint that generates the necessary Solana transaction for a user to purchase a skill. This endpoint will not execute the transaction but will prepare it for the user to sign on the frontend.

## Explanation
The purchase process must be secure and initiated by the server. This endpoint (`/api/marketplace/skills/purchase`) will be responsible for fetching the skill's price, identifying the creator's treasury wallet, and constructing an unsigned Solana transfer transaction. This transaction is then sent back to the frontend, which will request the user's signature.

## Instructions
1.  **Create New API File:**
    *   Create a new file in `api/marketplace/skills/purchase.js`. This will contain the logic for the new endpoint.

2.  **Endpoint Logic:**
    *   The endpoint should accept a POST request with the `agentId` and `skillName`.
    *   It must also know the `purchaser`'s public key, which should be sent from the frontend.
    *   **Security:** The endpoint must verify the agent and skill exist and have a valid price.
    *   It needs to look up the agent creator's treasury wallet address.
    *   Using the Solana `@solana/web3.js` library, construct a transaction that transfers the correct amount of the specified currency (e.g., USDC) from the `purchaser` to the creator's treasury wallet.
    *   The endpoint should serialize the transaction, but *not* sign it, and return it to the frontend as a base64-encoded string.

## Code Example (`api/marketplace/skills/purchase.js`)

```javascript
import { Connection, PublicKey, SystemProgram, Transaction, clusterApiUrl } from '@solana/web3.js';
import { supabase } from '../../_lib/supabase'; // Assuming Supabase for DB
import { json, error } from '../../_lib/http'; // Assuming helper for responses

// Mock get-token-address library for USDC on Solana
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyB7u6d';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return error(res, 405, 'Method Not Allowed');
    }

    const { agentId, skillName, purchaserPublicKey } = req.body;

    if (!agentId || !skillName || !purchaserPublicKey) {
        return error(res, 400, 'Missing required fields.');
    }

    // 1. Fetch skill price and agent creator's treasury wallet from DB
    const { data: priceData, error: priceError } = await supabase
        .from('agent_skill_prices')
        .select('amount, currency_mint, agents(creator_treasury_wallet)')
        .eq('agent_id', agentId)
        .eq('skill_name', skillName)
        .single();

    if (priceError || !priceData) {
        return error(res, 404, 'Skill price not found.');
    }

    const { amount, currency_mint, agents: { creator_treasury_wallet } } = priceData;

    if (!creator_treasury_wallet) {
        return error(res, 500, 'Creator has not configured a payout wallet.');
    }
    
    // For this example, we assume native SOL transfer for simplicity
    // A real implementation would handle SPL tokens like USDC, which is more complex.
    const connection = new Connection(clusterApiUrl('devnet'));
    const purchaser = new PublicKey(purchaserPublicKey);
    const recipient = new PublicKey(creator_treasury_wallet);
    
    const transaction = new Transaction().add(
        SystemProgram.transfer({
            fromPubkey: purchaser,
            toPubkey: recipient,
            lamports: amount, // Assuming amount is in lamports for SOL transfer
        })
    );

    // Set the recent blockhash
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    transaction.feePayer = purchaser;

    // Serialize the transaction and convert to base64
    const serializedTransaction = transaction.serialize({
        requireAllSignatures: false, // User will sign it
    }).toString('base64');

    return json(res, {
        transaction: serializedTransaction,
    });
}
```
