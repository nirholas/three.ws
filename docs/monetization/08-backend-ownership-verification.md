# Prompt 8: Backend Ownership Verification

## Objective
Create a secure backend endpoint that can verify whether a given user wallet holds the specific NFT required to access a paid skill.

## Explanation
Gating access to a feature requires a reliable way to check for ownership. This check must be done on the backend to prevent users from simply manipulating frontend code to bypass the restriction. The backend will query the Solana blockchain directly to verify NFT ownership.

## Instructions
1.  **Create Verification Endpoint:**
    *   Create a new API endpoint, e.g., `/api/skills/verify-ownership`.
    *   It should accept `user_wallet`, `agent_id`, and `skill_name` as query parameters.

2.  **Find the Required NFT:**
    *   This is the challenging part. A user could own many NFTs. You need to find the *correct* one.
    *   The most robust method is to query all token accounts for the `user_wallet`.
    *   Then, for each token they own (where `amount > 0`), fetch its metadata.
    *   Check the metadata to see if the NFT is part of the agent's verified `collection` (the `collection_mint` address you stored earlier).
    *   Also, check if the NFT's name or a trait in its metadata matches the `skill_name`.

3.  **Use a Solana RPC Provider or Indexer:**
    *   Fetching all this data can be slow using a standard RPC. For performance, use a dedicated NFT indexing service like Helius, Shyft, or SimpleHash. These services provide APIs to quickly fetch all NFTs owned by a wallet and their metadata.

4.  **Return Verification Status:**
    *   The endpoint should return a simple JSON response, like `{ "has_access": true }` or `{ "has_access": false }`.

## Code Example (Backend using Helius API)
```javascript
// This is a conceptual example of using an indexer API

async function verifyOwnership(req, res) {
    const { user_wallet, agent_id, skill_name } = req.query;
    const agent = await getAgentFromDB(agent_id);
    const agentCollectionMint = agent.collection_mint;

    // Use an indexer API to get all assets owned by the user
    const response = await fetch(`https://api.helius.xyz/v0/addresses/${user_wallet}/nfts?api-key=YOUR_API_KEY`);
    const data = await response.json();

    let has_access = false;
    for (const nft of data.items) {
        if (nft.grouping?.group_key === 'collection' && nft.grouping?.group_value === agentCollectionMint) {
            // This NFT is in the right collection. Now check if it's the right skill.
            if (nft.content?.metadata?.name.includes(skill_name)) {
                has_access = true;
                break;
            }
        }
    }

    res.status(200).json({ has_access });
}
```
