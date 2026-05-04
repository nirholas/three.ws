# Prompt 16: On-Chain License as an NFT (Optional)

## Objective
Optionally, extend the purchase flow to mint an NFT (Non-Fungible Token) that represents the user's license to use a skill, and store the mint address in the purchase record.

## Explanation
Minting a skill license as an NFT provides true on-chain ownership for the user. They can hold it, trade it, or use it as a verifiable credential. This transforms a simple database entry into a persistent, user-owned digital asset, aligning with Web3 principles. This would likely use the Metaplex standard on Solana.

## Instructions
1.  **Design the NFT Metadata:**
    *   Define a metadata standard for the skill license NFT. It should include attributes for the `agent_id`, `skill_id`, `purchase_date`, etc.

2.  **Create a Server-Side Minting Service:**
    *   This is a complex task that requires a secure backend wallet (a "minter") with funds to pay for transaction fees.
    *   Create a new API endpoint, e.g., `api/minter/mint-skill-license.js`.
    *   This endpoint will be called *after* a purchase is confirmed by the webhook.
    *   **Logic:**
        *   Take a `purchaseId` as input.
        *   Load the secure minter keypair.
        *   Use the Metaplex Umi or Helio SDK to create and mint a new NFT to the purchaser's wallet address.
        *   Use the metadata standard defined in step 1.
        *   The user's wallet address should be stored in your `users` table.

3.  **Update Purchase Table:**
    *   Add a new nullable column to the `user_skill_purchases` table: `license_nft_mint` (TEXT).
    *   After successfully minting the NFT, save the NFT's mint address to this column for the corresponding purchase record.

4.  **Display NFT on Frontend:**
    *   On the "My Purchased Skills" page, if a `license_nft_mint` exists, provide a link to a Solana explorer (like Solscan or X-Ray) to view the NFT.

## Note
This is an advanced feature. It requires secure key management on the backend, knowledge of a Solana SDK like Umi, and handling of on-chain transaction statuses.
