# Prompt 7: Mint Skill NFT on Purchase

## Objective
After a user's payment transaction is successfully confirmed, the backend should mint a new NFT from the agent's collection to the user's wallet.

## Explanation
This step connects the payment with the proof-of-ownership. Minting an NFT serves as an on-chain receipt and a perpetual license for the user to access the skill. This NFT is a standard SPL token, making it viewable in wallets and on explorers.

## Instructions
1.  **Create a Backend Minting Endpoint:**
    *   Create a new API endpoint, e.g., `/api/skills/mint`. This endpoint should be called by the frontend *after* a payment transaction is confirmed.
    *   It should accept the `agent_id`, `skill_name`, and the `user_wallet` address as parameters. It should also take the payment `transaction_signature` for verification.

2.  **Verify Payment:**
    *   Before minting, the backend *must* verify that the provided `transaction_signature` is valid, recent, and corresponds to the correct payment (correct amount to the correct creator). This prevents fraudulent minting requests.

3.  **Mint the NFT using Umi:**
    *   Fetch the agent's `collection_mint` address from the database.
    *   Generate a new signer for the skill NFT's mint address.
    *   Use Umi's `createNft` function, but this time:
        *   Set the `collection` property to the agent's collection mint address.
        *   The `name` and `uri` should be specific to the skill being purchased.
        *   The `owner` should be the user's public key.

4.  **Return NFT Details:**
    *   The endpoint should return the mint address of the newly created skill NFT to the frontend.

## Code Example (Backend Minting Endpoint using Umi)
```javascript
// Inside the /api/skills/mint endpoint
import { createNft, mplTokenMetadata } from '@metaplex-foundation/mpl-token-metadata';

// ... (After setting up umi and verifying payment)

const agentCollectionMint = getAgentCollectionMintFromDB(agentId);
const userPublicKey = new PublicKey(userWallet);
const skillNftMint = generateSigner(umi);

const { signature } = await createNft(umi, {
    mint: skillNftMint,
    owner: userPublicKey,
    name: `Skill: ${skillName}`,
    uri: `URL_TO_${skillName}_METADATA.json`,
    sellerFeeBasisPoints: percentAmount(0), // No royalties on individual skills
    collection: {
        verified: false, // The collection authority needs to verify this in a separate transaction
        key: agentCollectionMint,
    },
}).sendAndConfirm(umi);

// After minting, you must also run a 'verifyCollection' transaction
// so the NFT shows up as part of the official collection in wallets.

res.status(200).json({ nftMint: skillNftMint.publicKey, signature });
```
