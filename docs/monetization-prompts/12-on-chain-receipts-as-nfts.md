# Prompt 12: Generate On-Chain Receipts as NFTs

**Status:** - [ ] Not Started

## Objective
Issue a unique, non-transferable NFT to the user upon a successful skill purchase, serving as an on-chain receipt and proof of ownership.

## Explanation
Using NFTs as receipts provides a permanent, verifiable, and user-owned record of their purchase on the blockchain. This can unlock future possibilities like community-gated access or special privileges for skill owners. We can use a service like Metaplex for this.

## Instructions
1.  **Set up NFT Minting Infrastructure:**
    *   This is a significant step. You can use Metaplex's Candy Machine or their newer Core standards. For simple receipts, a direct mint via the Metaplex Umi library might be sufficient.
    *   You'll need a backend wallet with SOL to pay for minting fees.

2.  **Modify the Purchase Verification Endpoint:**
    *   In `/api/marketplace/purchase-skill.js`, after successfully verifying the transaction and recording the purchase in the database, trigger the NFT minting process.
    *   The metadata for the NFT should include:
        *   Name: e.g., "Skill Receipt: 'sentiment-analysis'"
        *   Symbol: e.g., "3WS-SKILL"
        *   Description: "This NFT represents ownership of the 'sentiment-analysis' skill for the agent 'AI Market Analyst'."
        *   Attributes: Agent Name, Skill Name, Purchase Date.
        *   Image: A custom image for skill receipts, or maybe the agent's thumbnail.

3.  **Mint and Send the NFT:**
    *   The backend will construct and sign the transaction to create the mint account, create the token account for the user, and mint the NFT to that account.
    *   The NFT should ideally be non-transferable to act as a "soul-bound" token representing access, not a speculative asset. This can be set with Metaplex's standards.

4.  **Update Database Record:**
    *   After minting, store the NFT's mint address in the `user_agent_skills` table. This links the off-chain record to the on-chain asset.

## Code Example (Conceptual Backend - adding to `purchase-skill.js`)

```javascript
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplCore, createV1, mintV1 } from '@metaplex-foundation/mpl-core';
import { keypairIdentity, Pda } from '@metaplex-foundation/umi';

// After successfully recording purchase in DB...
async function mintReceiptNFT(userAddress, agent, skillName) {
  const umi = createUmi('your_rpc_url').use(mplCore());
  
  // Use a secure way to load your backend/minter wallet
  const minterKeypair = ...; 
  umi.use(keypairIdentity(minterKeypair));

  const newMint = Pda.find(umi.context, 'core-mint', [minterKeypair.publicKey, 0]);

  await createV1(umi, {
    mint: newMint,
    name: `Skill: ${skillName}`,
    uri: `https://your-api.com/api/nft-metadata/${agent.id}/${skillName}`,
    plugins: [
      // This is conceptual - the exact non-transferable implementation
      // depends on the Metaplex standard you choose (e.g., locking delegates).
    ]
  }).sendAndConfirm(umi);

  await mintV1(umi, {
    mint: newMint.publicKey,
    authority: minterKeypair,
    assetOwner: new PublicKey(userAddress),
  }).sendAndConfirm(umi);

  return newMint.publicKey;
}

// In the main handler:
if (verificationSuccess) {
  await db.recordSkillPurchase(userId, agentId, skillName);
  const nftMintAddress = await mintReceiptNFT(userWalletAddress, agent, skillName);
  await db.updatePurchaseWithNftAddress(purchaseId, nftMintAddress);

  return res.status(200).json({ success: true, message: 'Purchase successful!', receiptNft: nftMintAddress });
}
```
*Note: This is a highly simplified example. NFT minting with Metaplex requires careful setup and handling of accounts and authorities.*
