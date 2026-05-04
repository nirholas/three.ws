---
status: not-started
last_updated: 2026-05-04
---
# Prompt 21: Gating Agent Access Based on NFT Ownership

## Objective
Implement a new monetization mechanism where creators can restrict access to their entire agent (or specific skills) to holders of a specific NFT collection.

## Explanation
Token-gating is a powerful web3-native monetization strategy. It builds community and provides utility for NFT holders. This feature will allow creators to specify an NFT collection's "Verified Creator" address (formerly known as `updateAuthority`), and our system will check if a user holds an NFT from that collection before granting access.

## Instructions
1.  **Update UI for Gating Configuration:**
    *   In `agent-edit.html`, add a new section for "Access Control".
    *   Include an option to select "Token Gating" and an input field for the "NFT Collection Address" (this will be the Verified Creator address).

2.  **Database Changes:**
    *   Add a column to the `agent_identities` table's `meta` field or a new table to store this gating rule (e.g., `meta.access_rule = { type: 'NFT_HOLD', collection_address: '...' }`).

3.  **Backend - Gated Access Check:**
    *   This check should happen in the same place as the skill ownership check (e.g., `api/chat.js`).
    *   When a user tries to interact with a gated agent:
        *   **Fetch User's NFTs:** Use a Solana RPC provider or an indexing service like Helius or Shyft to get all NFTs owned by the user's wallet address. The RPC `getTokenAccountsByOwner` method combined with parsing can work, but indexers are far more efficient.
        *   **Verify Collection:** Iterate through the user's NFTs. For each NFT, fetch its metadata. The metadata (e.g., from an Arweave URL) will contain a `collection` field or a `creators` array. Check if the collection's `key` or one of the creator's `address` matches the `collection_address` specified by the agent creator.
        *   If a match is found, grant access.
        *   If no matching NFT is found, return a `403 Forbidden` error with a message like "You must hold an NFT from the required collection to use this agent."

## Code Example (Backend NFT Check Logic using an Indexer)

```javascript
// This is a conceptual example. The exact API will depend on the indexer used.
// Assume `userWalletAddress` and `requiredCollectionAddress` are known.

async function userHoldsNftFromCollection(userWalletAddress, requiredCollectionAddress) {
    const HELIUS_API_URL = `https://api.helius.xyz/v0/addresses/${userWalletAddress}/nfts?api-key=...`;

    const response = await fetch(HELIUS_API_URL);
    const data = await response.json();

    for (const nft of data.nfts) {
        // Helius provides a verified collection address directly
        const collectionInfo = nft.grouping.find(g => g.group_key === 'collection');
        if (collectionInfo && collectionInfo.group_value === requiredCollectionAddress) {
            return true; // Found a matching NFT
        }
    }

    return false; // No match found
}

// In the access control middleware/handler:
const isHolder = await userHoldsNftFromCollection(user.wallet_address, agent.meta.access_rule.collection_address);

if (!isHolder) {
    return error(res, 403, 'nft_required', 'Access denied. NFT from required collection not found in your wallet.');
}
// Proceed...
```
