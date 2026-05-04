---
status: not-started
---

# Prompt 12: Gated Content/Skills via NFTs

**Status:** Not Started

## Objective
Allow creators to restrict access to skills to only holders of a specific NFT.

## Explanation
To add more utility for NFT projects, we can allow agent creators to gate their skills. Only users who hold a specific NFT (from a certain collection) in their wallet can use the skill.

## Instructions
- [ ] **Modify the `agent_skill_prices` table (or create a new `agent_skill_gates` table).**
    - Add a `gate_type` column (e.g., `price` or `nft`).
    - Add an `nft_collection_mint` column.
- [ ] **Update the creator dashboard UI.**
    - Allow creators to choose "NFT Gate" as a pricing option.
    - If chosen, provide an input for the NFT collection mint address.
- [ ] **Modify the skill access control check.**
    - If a skill is gated by an NFT:
        - Get the user's wallet address.
        - Use a Solana RPC provider (e.g., Helius) to check if the user's wallet holds at least one NFT from the `nft_collection_mint`.
        - If they do, grant access. If not, return a `402` error with a message like "You need to hold an NFT from collection X to use this skill."
- [ ] **Update the UI to show NFT-gated skills.**
    - Clearly indicate that a skill is "Token Gated" and show the required collection.
