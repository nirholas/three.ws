# Prompt 6: Create Skill NFT Collection

## Objective
Develop a script or backend process to create a unique NFT collection for each agent. This collection will be used to mint "skill ownership" NFTs to users who purchase them.

## Explanation
Using NFTs to represent ownership provides a verifiable, on-chain record that a user has paid for a skill. The first step is to create a "collection" NFT, which acts as a master identifier for all the skill NFTs belonging to a specific agent. This ensures authenticity and allows for easy verification.

## Instructions
1.  **Use Metaplex Umi:**
    *   The backend will need to interact with the Solana network. Use the Metaplex Umi library, which simplifies creating and managing NFTs.
    *   Set up a backend wallet (the "collection authority") that will pay the fees for creating the collection.

2.  **Create Collection Script/Endpoint:**
    *   Develop a script (`scripts/create-agent-collection.mjs`) or a secure backend endpoint.
    *   This function should take an agent ID as input.
    *   It should generate a new keypair for the collection NFT's mint address.
    *   Using Umi, it will build and send a transaction to create:
        1.  The collection mint account.
        2.  The associated token account.
        3.  The collection's metadata account (with name, symbol, etc., tied to the agent).
        4.  The master edition account.

3.  **Store Collection Address:**
    *   After the collection is created, its mint address must be stored in the database, associated with the agent. Add a `collection_mint` column to the `agents` table.

## Code Example (Backend Script using Umi)
```javascript
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createNft, mplTokenMetadata } from '@metaplex-foundation/mpl-token-metadata';
import { generateSigner, percentAmount } from '@metaplex-foundation/umi';

// 1. Setup Umi
const umi = createUmi('https://api.devnet.solana.com').use(mplTokenMetadata());
// Add your backend keypair to umi

// 2. Define the collection details
const collectionMint = generateSigner(umi);

// 3. Create the Collection NFT
async function createCollection() {
    await createNft(umi, {
        mint: collectionMint,
        name: "Agent 'X' Skills",
        symbol: 'AGENTX',
        uri: 'URL_TO_JSON_METADATA', // Link to a JSON file with image, description, etc.
        sellerFeeBasisPoints: percentAmount(5.5), // 5.5% royalty
        isCollection: true,
    }).sendAndConfirm(umi);

    console.log('Collection created with mint address:', collectionMint.publicKey);
    // 4. Save `collectionMint.publicKey` to the database for the agent.
}

createCollection();
```
