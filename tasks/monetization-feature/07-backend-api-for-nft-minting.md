---
status: not-started
---

# Prompt 7: Backend - API for Skill NFT Minting

**Status:** Not Started

## Objective
Create an API endpoint that allows a user to purchase a skill and receive it as an NFT. This endpoint will be responsible for creating and processing the Solana transaction.

## Explanation
This is the core of the monetization feature. This API will take a user's public key and the desired skill, and in return, provide a transaction that, when signed by the user, will transfer the funds and mint the skill NFT to their wallet. We will use Solana Pay's Transaction Request standard for a seamless user experience.

## Instructions
1.  **Create the API Endpoint:**
    -   Create a new API route, for example, `/api/skills/purchase`.
    -   Implement a `POST` handler that accepts `user_account`, `agent_id`, and `skill_name`.

2.  **Implement the Transaction Logic:**
    -   Fetch the skill's price from the `agent_skill_prices` table.
    -   Fetch the agent creator's wallet address from the `users` table.
    -   Fetch the agent's `skill_collection_mint` from the `agents` table.
    -   Upload the skill's NFT metadata (as defined in Prompt 5) to Arweave or IPFS.
    -   Generate a new keypair for the skill NFT's mint account.
    -   Build a Solana transaction using `@solana/web3.js`. This transaction must include:
        -   A `SystemProgram.transfer` instruction to send the purchase amount from the `user_account` to the creator's wallet.
        -   The instructions to create and mint the new NFT, associating it with the agent's collection. Use the Metaplex Umi library for this.
    -   Serialize the transaction, but *do not* sign it.

3.  **Return a Solana Pay-Compatible Response:**
    -   The API response should follow the Solana Pay Transaction Request standard.
    -   The `transaction` field should be the base64-encoded serialized transaction.
    -   Include a `message` like "Purchase Skill '[Skill Name]' for [Amount] USDC".

## Code Example (Vercel Serverless Function - `api/skills/purchase.js`)

```javascript
import { createNft } from '@metaplex-foundation/mpl-token-metadata';
import { generateSigner, some } from '@metaplex-foundation/umi';
import { Transaction, SystemProgram, PublicKey } from '@solana/web3.js';
import { initializeUmi } from '@lib/solana/umi';
import { db } from '@lib/db';

async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).end();
    }
    const { user_account, agent_id, skill_name } = req.body;

    try {
        // 1. Fetch all required data
        const priceInfo = await db.query('SELECT * FROM agent_skill_prices WHERE agent_id = $1 AND skill_name = $2', [agent_id, skill_name]);
        const agent = await db.query('SELECT owner_id, skill_collection_mint FROM agents WHERE id = $1', [agent_id]);
        const creator = await db.query('SELECT wallet_address FROM users WHERE id = $1', [agent.rows[0].owner_id]);
        
        if (!priceInfo.rows.length || !creator.rows.length || !agent.rows[0].skill_collection_mint) {
            return res.status(404).json({ error: 'Skill or creator not found' });
        }
        
        const umi = initializeUmi();
        const skillMint = generateSigner(umi);
        
        // 2. TODO: Upload metadata to Arweave
        const metadataUri = 'https://...';

        // 3. Build the mint instruction
        const mintIx = createNft(umi, {
            mint: skillMint,
            name: skill_name,
            uri: metadataUri,
            sellerFeeBasisPoints: percentAmount(0),
            collection: some({ key: new PublicKey(agent.rows[0].skill_collection_mint), verified: false }),
        }).getInstructions();

        // 4. Build the full transaction
        let transaction = new Transaction();
        transaction.add(
            SystemProgram.transfer({
                fromPubkey: new PublicKey(user_account),
                toPubkey: new PublicKey(creator.rows[0].wallet_address),
                lamports: priceInfo.rows[0].amount,
            })
        );
        // This is a simplification; you'd convert the Umi instructions to web3.js format
        // transaction.add(...convertedMintIx); 

        // 5. Return Solana Pay response
        const serializedTransaction = transaction.serialize({ requireAllSignatures: false });
        
        return res.status(200).json({
            transaction: serializedTransaction.toString('base64'),
            message: `Purchase ${skill_name} for ${priceInfo.rows[0].amount / 1e6} USDC`,
        });

    } catch (error) {
        console.error('Failed to create purchase transaction:', error);
        return res.status(500).json({ error: 'Failed to create transaction' });
    }
}
```

## Definition of Done
-   The `/api/skills/purchase` endpoint is created.
-   The endpoint correctly fetches all necessary data.
-   It generates a transaction with both the payment and minting instructions.
-   The response is compatible with the Solana Pay Transaction Request standard.
