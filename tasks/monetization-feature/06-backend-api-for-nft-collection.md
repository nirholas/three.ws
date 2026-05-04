---
status: not-started
---

# Prompt 6: Backend - API for NFT Collection Creation

**Status:** Not Started

## Objective
Create an API endpoint for an authenticated agent creator to generate a new Metaplex Certified Collection on Solana, which will be used to group all the paid skills for a specific agent.

## Explanation
Before we can mint individual skill NFTs, they need to belong to a "collection." This allows marketplaces to group them and verifies their authenticity. This task involves creating an API that uses the Metaplex Umi library to create a new NFT collection on behalf of the agent's creator. The platform will be the update authority to manage the collection.

## Instructions
1.  **Set up Metaplex Umi:**
    -   Install the necessary Metaplex and Solana libraries (`@metaplex-foundation/umi-bundle-defaults`, `@metaplex-foundation/mpl-token-metadata`, `@solana/web3.js`).
    -   Create a helper function to initialize Umi with your platform's keypair and connection to the Solana devnet.

2.  **Create the API Endpoint:**
    -   Create a new API route, for example, `/api/agents/[id]/skill-collection`.
    -   Implement a `POST` handler that is protected, ensuring only the agent owner can create a collection.

3.  **Implement the Collection Creation Logic:**
    -   The handler should first check if a collection already exists for this agent to prevent duplicates.
    -   Generate a new keypair for the collection NFT's mint account.
    -   Use the `createNft` function from `@metaplex-foundation/mpl-token-metadata`.
    -   The `createNft` call should specify:
        -   `name`: e.g., "Agent [Agent Name] Skills"
        -   `symbol`: e.g., "A1SKILL"
        -   `uri`: A URL to a JSON file containing the collection's metadata (e.g., agent's name, description, image).
        -   `sellerFeeBasisPoints`: Set to `0` for the collection NFT itself.
        -   `isCollection`: `true`.
    -   Store the collection's mint address in the `agents` table, associated with the agent `id`.

## Code Example (Vercel Serverless Function - `api/agents/[id]/skill-collection.js`)

```javascript
import { createNft } from '@metaplex-foundation/mpl-token-metadata';
import { generateSigner, percentAmount } from '@metaplex-foundation/umi';
import { initializeUmi } from '@lib/solana/umi'; // Your Umi setup helper
import { db } from '@lib/db';
import { withAuth } from '@lib/auth';

async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).end();
    }
    const { id: agentId } = req.query;
    const { userId } = req.auth;

    // 1. Verify ownership and check if collection already exists
    const agent = await db.query('SELECT owner_id, skill_collection_mint FROM agents WHERE id = $1', [agentId]);
    if (!agent.rows.length || agent.rows[0].owner_id !== userId) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    if (agent.rows[0].skill_collection_mint) {
        return res.status(400).json({ error: 'Collection already exists' });
    }

    try {
        const umi = initializeUmi();
        const collectionMint = generateSigner(umi);

        // TODO: Upload collection metadata to Arweave/IPFS
        const collectionMetadataUri = 'https://...'; 

        await createNft(umi, {
            mint: collectionMint,
            name: `Agent ${agent.name} Skills`,
            symbol: 'A1SKILL',
            uri: collectionMetadataUri,
            sellerFeeBasisPoints: percentAmount(0),
            isCollection: true,
        }).sendAndConfirm(umi);

        const collectionMintAddress = collectionMint.publicKey;

        // 3. Save the mint address to your database
        await db.query('UPDATE agents SET skill_collection_mint = $1 WHERE id = $2', [collectionMintAddress, agentId]);

        return res.status(200).json({ collectionMint: collectionMintAddress });
    } catch (error) {
        console.error('Failed to create collection NFT:', error);
        return res.status(500).json({ error: 'Failed to create collection' });
    }
}

export default withAuth(handler);
```

## Definition of Done
-   The `/api/agents/[id]/skill-collection` endpoint is created and functional.
-   When called by the agent owner, a new Metaplex collection NFT is created on Solana devnet.
-   The new collection's mint address is saved to the `agents` table.
-   The endpoint correctly handles errors and prevents duplicate collection creation.
